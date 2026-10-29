// ───────────────────────── core: palette, math, easing, drawing ─────────────────────────
// Two layers per frame:  T = "tone" (fills/shading → halftoned by the shader: gray = black ink, red = red ink)
//                        K = "ink"  (crisp lines, type, stamps; composited on top untouched)
const W = 1080, H = 1920, D2R = Math.PI / 180, TAU = Math.PI * 2;
const C = {
  ink: '#111111', paper: '#F3F1EA', red: '#FF3B1F', redD: '#C81E0C',
  // tone-layer values (the shader reads these as ink densities)
  k10: '#E6E6E6', k20: '#CCCCCC', k30: '#B3B3B3', k45: '#8C8C8C', k60: '#666666', k75: '#404040', k90: '#1A1A1A', k100: '#000000',
  r100: '#FF0000', r60: '#FF6666', r35: '#FFA6A6', r20: '#FFCCCC',
};
const F = { anton: 'Anton, "Fallback"', grot: '"Space Grotesk", "Fallback"', serif: '"Instrument Serif", "Fallback"', mono: '"JetBrains Mono", "Fallback"' };   // "Fallback" = on-demand non-Latin fonts (tools/fonts.py)

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const inv = (a, b, x) => clamp((x - a) / (b - a));
const E = {
  lin: t => t,
  outQuad: t => 1 - (1 - t) * (1 - t),
  inCubic: t => t * t * t,
  outCubic: t => 1 - Math.pow(1 - t, 3),
  inOutCubic: t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  inQuart: t => t ** 4,
  outQuart: t => 1 - Math.pow(1 - t, 4),
  outQuint: t => 1 - Math.pow(1 - t, 5),
  outExpo: t => t >= 1 ? 1 : 1 - Math.pow(2, -10 * t),
  inExpo: t => t <= 0 ? 0 : Math.pow(2, 10 * t - 10),
  inOutExpo: t => t <= 0 ? 0 : t >= 1 ? 1 : t < .5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2,
  inOutQuint: t => t < .5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2,
  outBack: t => { const s = 1.70158; return 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2); },
  outBackX: t => { const s = 2.6; return 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2); },
  inBack: t => { const s = 1.70158; return (s + 1) * t * t * t - s * t * t; },
};
// common names agents reach for (aliases so a guess never throws)
E.inQuad = t => t * t; E.inOutQuad = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
E.inOutBack = t => { const c = 1.70158 * 1.525; return t < 0.5 ? (Math.pow(2 * t, 2) * ((c + 1) * 2 * t - c)) / 2 : (Math.pow(2 * t - 2, 2) * ((c + 1) * (t * 2 - 2) + c) + 2) / 2; };
E.inOutSine = t => -(Math.cos(Math.PI * t) - 1) / 2; E.outSine = t => Math.sin(t * Math.PI / 2); E.inSine = t => 1 - Math.cos(t * Math.PI / 2);

const P = (t, a, d, e = E.lin) => e(clamp((t - a) / d));
// damped spring 0 → 1 with overshoot
const spring = (dt, f = 2.4, z = 0.36) => {
  if (dt <= 0) return 0;
  const w = TAU * f;
  return 1 - Math.exp(-z * w * dt) * Math.cos(w * Math.sqrt(1 - z * z) * dt);
};
const ring = (dt, f = 3.5, k = 7) => dt < 0 ? 0 : Math.exp(-k * dt) * Math.cos(TAU * f * dt);
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const noise1 = x => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(hash(i), hash(i + 1), u) * 2 - 1; };
function rng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const money = (n, cur = '$') => cur + Math.round(n).toLocaleString('en-US');

// ───────────── shapes ─────────────
function rr(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function fillRR(ctx, x, y, w, h, r, fill) { rr(ctx, x, y, w, h, r); ctx.fillStyle = fill; ctx.fill(); }
function strokeRR(ctx, x, y, w, h, r, col = C.ink, lw = 6) { rr(ctx, x, y, w, h, r); ctx.lineWidth = lw; ctx.strokeStyle = col; ctx.lineJoin = 'round'; ctx.stroke(); }
// a card: halftone drop shadow on T, paper fill + ink outline on K
function card(T, K, x, y, w, h, o = {}) {
  const { r = 26, sh = 22, shade = C.k60, fill = C.paper, lw = 6, stroke = C.ink, tone = null } = o;
  if (sh) fillRR(T, x + sh, y + sh, w, h, r, shade);
  fillRR(T, x, y, w, h, r, tone || '#FFFFFF');
  if (lw) strokeRR(K, x, y, w, h, r, stroke, lw);
}
function circle(ctx, x, y, r, fill, stroke, lw = 6) {
  ctx.beginPath(); ctx.arc(x, y, Math.max(0, r), 0, TAU);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.stroke(); }
}
function line(ctx, x1, y1, x2, y2, col = C.ink, lw = 6, cap = 'round') {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineWidth = lw; ctx.strokeStyle = col; ctx.lineCap = cap; ctx.stroke();
}
function font(o) { return `${o.italic ? 'italic ' : ''}${o.weight || 700} ${o.size || 100}px ${o.font || F.grot}`; }
function text(ctx, str, x, y, o = {}) {
  ctx.save();
  ctx.font = font(o);
  ctx.textAlign = o.align || 'center';
  ctx.textBaseline = o.base || 'alphabetic';
  ctx.letterSpacing = (o.ls || 0) + 'px';
  if (o.slw) { ctx.lineWidth = o.slw; ctx.strokeStyle = o.stroke || C.paper; ctx.lineJoin = 'round'; ctx.strokeText(str, x, y); }
  ctx.fillStyle = o.color || C.ink;
  ctx.fillText(str, x, y);
  ctx.restore();
}
function measure(ctx, str, o) { ctx.save(); ctx.font = font(o); ctx.letterSpacing = (o.ls || 0) + 'px'; const w = ctx.measureText(str).width; ctx.restore(); return w; }
// per-letter kinetic text. fn(i, n, ch) → {dx, dy, s, sx, sy, r, a, c}
function letters(ctx, str, x, y, o, fn) {
  ctx.save(); ctx.font = font(o); ctx.letterSpacing = '0px';
  const ls = o.ls || 0, chars = [...str];
  const ws = chars.map(c => ctx.measureText(c).width);
  const total = ws.reduce((a, b) => a + b, 0) + ls * (chars.length - 1);
  let cx = o.align === 'left' ? x : o.align === 'right' ? x - total : x - total / 2;
  ctx.restore();
  chars.forEach((ch, i) => {
    const m = Object.assign({ dx: 0, dy: 0, s: 1, sx: 1, sy: 1, r: 0, a: 1 }, fn(i, chars.length, ch));
    if (m.a > 0.001 && m.s > 0.001 && ch !== ' ') {
      ctx.save();
      ctx.globalAlpha *= clamp(m.a);
      ctx.translate(cx + ws[i] / 2 + m.dx, y + m.dy);
      ctx.rotate(m.r * D2R); ctx.scale(m.s * m.sx, m.s * m.sy);
      text(ctx, ch, 0, 0, Object.assign({}, o, { align: 'center', ls: 0 }, m.c ? { color: m.c } : {}));
      ctx.restore();
    }
    cx += ws[i] + ls;
  });
  return total;
}
// slot-machine digits: rolls each digit column from 0 to its target, staggered right→left
function slot(ctx, str, x, y, o, p) {
  ctx.save(); ctx.font = font(o);
  const chars = [...str], ws = chars.map(c => ctx.measureText(c).width);
  const total = ws.reduce((a, b) => a + b, 0) + (o.ls || 0) * (chars.length - 1);
  const size = o.size || 100, top = y - size * 0.95, hgt = size * 1.12;
  let cx = o.align === 'left' ? x : o.align === 'right' ? x - total : x - total / 2;
  let di = 0; const nd = chars.filter(c => /\d/.test(c)).length;
  chars.forEach((ch, i) => {
    const cxm = cx + ws[i] / 2;
    if (/\d/.test(ch)) {
      const k = nd - 1 - di++;
      const q = E.outCubic(clamp(p * 1.5 - k * 0.07));
      const target = +ch + 10 * (2 + k % 3);
      const v = q * target;
      ctx.save(); ctx.beginPath(); ctx.rect(cxm - ws[i], top, ws[i] * 2, hgt); ctx.clip();
      for (let d = Math.floor(v) - 1; d <= Math.floor(v) + 1; d++) {
        const yy = y + (d - v) * hgt;
        text(ctx, String(((d % 10) + 10) % 10), cxm, yy, Object.assign({}, o, { align: 'center', ls: 0 }));
      }
      ctx.restore();
    } else text(ctx, ch, cxm, y, Object.assign({}, o, { align: 'center', ls: 0 }));
    cx += ws[i] + (o.ls || 0);
  });
  ctx.restore();
  return total;
}
function check(ctx, x, y, s, p, color = C.ink, lw = 12) {
  if (p <= 0) return;
  const pts = [[-0.45, 0.02], [-0.12, 0.34], [0.5, -0.32]].map(([a, b]) => [x + a * s, y + b * s]);
  const l1 = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]), l2 = Math.hypot(pts[2][0] - pts[1][0], pts[2][1] - pts[1][1]);
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.setLineDash([l1 + l2, l1 + l2]); ctx.lineDashOffset = (l1 + l2) * (1 - p);
  ctx.beginPath(); ctx.moveTo(...pts[0]); ctx.lineTo(...pts[1]); ctx.lineTo(...pts[2]); ctx.stroke(); ctx.restore();
}
function cross(ctx, x, y, s, p, color = C.red, lw = 12) {
  if (p <= 0) return;
  const a = clamp(p * 2), b = clamp(p * 2 - 1);
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x - s / 2, y - s / 2); ctx.lineTo(x - s / 2 + s * a, y - s / 2 + s * a); ctx.stroke();
  if (b > 0) { ctx.beginPath(); ctx.moveTo(x + s / 2, y - s / 2); ctx.lineTo(x + s / 2 - s * b, y - s / 2 + s * b); ctx.stroke(); }
  ctx.restore();
}
// draw a path progressively (0..1) with dash trick
function strokeP(ctx, pathFn, len, p, col = C.ink, lw = 6) {
  if (p <= 0) return;
  ctx.save(); ctx.setLineDash([len, len]); ctx.lineDashOffset = len * (1 - p); ctx.lineWidth = lw; ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  pathFn(ctx); ctx.stroke(); ctx.restore();
}
function burst(ctx, x, y, dt, o = {}) {
  const { n = 12, r0 = 90, r1 = 300, color = C.ink, lw = 9, dur = 0.4, rot = 0 } = o;
  if (dt < 0 || dt > dur) return;
  const p = dt / dur, a = E.outCubic(p), b = E.outCubic(clamp(p * 1.6 - 0.35));
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = lw * (1 - p * 0.6); ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const ang = rot + i * TAU / n + (i % 2) * 0.12;
    const k = i % 2 ? 0.75 : 1;
    const ra = lerp(r0, r1 * k, b), rb = lerp(r0, r1 * k, a);
    if (rb - ra < 1) continue;
    ctx.beginPath(); ctx.moveTo(x + Math.cos(ang) * ra, y + Math.sin(ang) * ra);
    ctx.lineTo(x + Math.cos(ang) * rb, y + Math.sin(ang) * rb); ctx.stroke();
  }
  ctx.restore();
}
function shock(ctx, x, y, dt, o = {}) {
  const { r = 320, color = C.ink, lw = 10, dur = 0.5 } = o;
  if (dt < 0 || dt > dur) return;
  const p = dt / dur;
  ctx.save(); ctx.globalAlpha = 1 - p; circle(ctx, x, y, r * E.outExpo(p), null, color, lw * (1 - p) + 1); ctx.restore();
}
// rubber stamp (ink layer). p: 0..1 slam progress (dt-based)
function stamp(K, T, str, x, y, dt, o = {}) {
  if (dt < 0) return;
  const { size = 120, rot = -8, col = C.red, pad = 34, font: fnt = F.anton, sub = null } = o;
  const s = dt < 0.14 ? lerp(2.6, 1, E.inQuart(dt / 0.14)) : 1 + ring(dt - 0.14, 5, 12) * 0.05;
  const a = clamp(dt / 0.06);
  const subF = { font: F.mono, weight: 700, size: Math.round(size * 0.22), ls: 3 };
  const tw = Math.max(measure(K, str, { font: fnt, weight: 400, size, ls: 4 }), sub ? measure(K, sub, subF) : 0);   // the frame fits both lines
  // height: the no-sub frame (caps ≈ 0.74·size centred), plus room for the sub line under the caps (its own margin below)
  const w = tw + pad * 2, h = size * 1.08 + pad * 1.1 + (sub ? pad * 0.5 + subF.size * 0.75 : 0);
  const base = sub ? -h / 2 + size * 0.17 + pad * 0.55 + size * 0.74 : size * 0.4;   // main baseline
  // drawn on a scratch layer so the worn-ink specks erase only the stamp's own ink, never the card/art under it
  const cv = K.canvas, S = _stampLayer(cv.width, cv.height);
  S.setTransform(1, 0, 0, 1, 0, 0); S.globalCompositeOperation = 'source-over'; S.globalAlpha = 1; S.clearRect(0, 0, cv.width, cv.height);
  S.setTransform(K.getTransform()); S.translate(x, y); S.rotate(rot * D2R); S.scale(s, s);
  strokeRR(S, -w / 2, -h / 2, w, h, 16, col, 10);
  strokeRR(S, -w / 2 + 16, -h / 2 + 16, w - 32, h - 32, 8, col, 4);
  text(S, str, 0, base, { font: fnt, weight: 400, size, color: col, ls: 4 });
  if (sub) text(S, sub, 0, base + pad * 0.5 + subF.size * 0.75, Object.assign({ color: col }, subF));
  // worn-ink speckle
  S.globalCompositeOperation = 'destination-out';
  const r = rng(str.length * 91 + Math.round(x));
  for (let i = 0; i < 70; i++) { const px = (r() - 0.5) * w, py = (r() - 0.5) * h; circle(S, px, py, r() * 5 + 1, '#000'); }
  K.save(); K.setTransform(1, 0, 0, 1, 0, 0); K.globalAlpha *= a; K.drawImage(S.canvas, 0, 0); K.restore();
}
let _stampC = null;
function _stampLayer(w, h) {
  if (!_stampC) _stampC = document.createElement('canvas');
  if (_stampC.width !== w || _stampC.height !== h) { _stampC.width = w; _stampC.height = h; }
  return _stampC.getContext('2d');
}
// simple glyph icons ----------------------------------------------------------
function person(ctx, x, y, s, fill = C.ink) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.fillStyle = fill;
  ctx.beginPath(); ctx.arc(0, -38, 22, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-40, 40); ctx.quadraticCurveTo(-40, -8, 0, -8); ctx.quadraticCurveTo(40, -8, 40, 40); ctx.closePath(); ctx.fill();
  ctx.restore();
}
function cursor(ctx, x, y, s = 1, press = 0) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s * (1 - press * 0.18), s * (1 - press * 0.18));
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(0, 92); ctx.lineTo(24, 70); ctx.lineTo(42, 108); ctx.lineTo(60, 100);
  ctx.lineTo(42, 62); ctx.lineTo(74, 60); ctx.closePath();
  ctx.fillStyle = C.paper; ctx.fill(); ctx.lineWidth = 7; ctx.lineJoin = 'round'; ctx.strokeStyle = C.ink; ctx.stroke();
  ctx.restore();
}
function envelope(ctx, x, y, w, h, lw = 6, col = C.ink, fill = C.paper) {
  fillRR(ctx, x - w / 2, y - h / 2, w, h, 10, fill); strokeRR(ctx, x - w / 2, y - h / 2, w, h, 10, col, lw);
  ctx.beginPath(); ctx.moveTo(x - w / 2 + 8, y - h / 2 + 8); ctx.lineTo(x, y + h * 0.08); ctx.lineTo(x + w / 2 - 8, y - h / 2 + 8);
  ctx.lineWidth = lw; ctx.strokeStyle = col; ctx.lineJoin = 'round'; ctx.stroke();
}
function warn(ctx, x, y, s, col = C.red) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.beginPath(); ctx.moveTo(0, -50); ctx.lineTo(52, 42); ctx.lineTo(-52, 42); ctx.closePath();
  ctx.fillStyle = col; ctx.lineJoin = 'round'; ctx.lineWidth = 12; ctx.strokeStyle = col; ctx.fill(); ctx.stroke();
  text(ctx, '!', 0, 34, { font: F.anton, weight: 400, size: 70, color: C.paper });
  ctx.restore();
}
// keyframe tracks ---------------------------------------------------------------
function Track(defaults) {
  const keys = {};
  for (const k in defaults) keys[k] = [{ t: -1e9, v: defaults[k], e: E.lin }];
  return {
    key(t, props, e = E.inOutCubic) { for (const k in props) { (keys[k] = keys[k] || []).push({ t, v: props[k], e }); keys[k].sort((a, b) => a.t - b.t); } return this; },
    at(t) {
      const o = {};
      for (const k in keys) {
        const ks = keys[k]; let i = ks.length - 1;
        while (i > 0 && ks[i].t > t) i--;
        const a = ks[i], b = ks[i + 1];
        o[k] = !b ? a.v : lerp(a.v, b.v, b.e(inv(a.t, b.t, t)));
      }
      return o;
    },
  };
}
