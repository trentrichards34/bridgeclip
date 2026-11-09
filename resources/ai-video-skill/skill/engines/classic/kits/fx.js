// ───────────────────────── fx kit: print-style effects (glows, impacts, marks, flows) ─────────────────────────
// T = tone layer (halftoned: black → grey dots, '255,0,0' → accent dots), K = crisp ink layer. All deterministic in t.

// halftone glow on T: rgb '0,0,0' (grey dots) or '255,0,0' (accent dots); a = 0..1
function glow(T, x, y, rx, ry, a, rgb = '255,0,0') {
  if (a <= 0.004) return;
  T.save(); T.translate(x, y); T.scale(1, ry / rx);
  const g = T.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(0.5, `rgba(${rgb},${a * 0.42})`); g.addColorStop(1, `rgba(${rgb},0)`);
  T.fillStyle = g; T.fillRect(-rx, -rx, rx * 2, rx * 2); T.restore();
}
// halftone dust puff on T (slams / drops). dir = 1 (puffs right) or -1
function puff(T, x, y, dt, s = 1, dir = 1) {
  if (dt < 0 || dt > 0.55) return;
  const p = dt / 0.55, e = E.outCubic(p);
  for (let i = 0; i < 4; i++) {
    const r = (16 + i * 8) * s * (0.45 + e), px = x + dir * (i * 24 + 70 * e) * s, py = y - (i % 2) * 12 * s - 26 * e * s;
    T.fillStyle = `rgba(0,0,0,${0.22 * (1 - p)})`; T.beginPath(); T.arc(px, py, r, 0, TAU); T.fill();
  }
}
// impact: accent halftone bloom, shock ring, two bursts and gravity sparks (dt = t - hit time)
function impact(T, K, x, y, dt, s = 1, seed = 1) {
  if (dt < 0 || dt > 0.8) return;
  glow(T, x, y, 240 * s, 160 * s, 0.9 * Math.exp(-dt * 4.2));
  shock(K, x, y, dt, { r: 175 * s, color: C.red, lw: 6 * s, dur: 0.42 });
  burst(K, x, y - 8 * s, dt, { n: 12, r0: 54 * s, r1: 178 * s, color: C.red, lw: 7 * s, dur: 0.3, rot: -0.12 });
  burst(K, x, y - 8 * s, dt - 0.035, { n: 7, r0: 84 * s, r1: 150 * s, color: C.ink, lw: 4 * s, dur: 0.26, rot: 0.33 });
  const R = rng(seed * 7919 + 11);
  for (let i = 0; i < 18; i++) {
    const ang = -Math.PI * (0.06 + 0.88 * R()), v = (430 + 680 * R()) * s, life = 0.26 + 0.36 * R(), col = R() < 0.74 ? C.red : C.ink;
    if (dt > life) continue;
    const k = 1 - dt / life, gr = 2600 * s, vx = Math.cos(ang) * v, vy = Math.sin(ang) * v + gr * dt;
    const px = x + Math.cos(ang) * v * dt, py = y + Math.sin(ang) * v * dt + 0.5 * gr * dt * dt;
    line(K, px - vx * 0.024, py - vy * 0.024, px, py, col, (2 + 3.6 * k) * s, 'round');
  }
}
// cubic bezier helpers: P = [[x0,y0],[c1],[c2],[x1,y1]]
const bez = (P, u) => { const v = 1 - u, a = v * v * v, b = 3 * v * v * u, c = 3 * v * u * u, d = u * u * u; return [a * P[0][0] + b * P[1][0] + c * P[2][0] + d * P[3][0], a * P[0][1] + b * P[1][1] + c * P[2][1] + d * P[3][1]]; };
function bezPath(K, P) { K.beginPath(); K.moveTo(P[0][0], P[0][1]); K.bezierCurveTo(P[1][0], P[1][1], P[2][0], P[2][1], P[3][0], P[3][1]); }
// a cable / connector drawn on progressively (p 0..1)
function cable(K, P, p = 1, col = C.ink, lw = 8) {
  if (p <= 0) return;
  const N = 40; let L = 0, prev = P[0]; for (let i = 1; i <= N; i++) { const q = bez(P, i / N); L += Math.hypot(q[0] - prev[0], q[1] - prev[1]); prev = q; }
  strokeP(K, c => { c.beginPath(); c.moveTo(P[0][0], P[0][1]); c.bezierCurveTo(P[1][0], P[1][1], P[2][0], P[2][1], P[3][0], P[3][1]); }, L, p, col, lw);
}
// energy flowing along a bezier P (start → end): a bright lead pulse, then a steady stream of accent dots
function flow(T, K, P, t, t0, o = {}) {
  if (t < t0) return;
  const N = 36, pts = [], L = [0];
  for (let i = 0; i <= N; i++) { pts.push(bez(P, i / N)); if (i) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); }
  const tot = L[N];
  const at = d => { d = clamp(d, 0, tot); let i = 1; while (i < N && L[i] < d) i++; const u = (d - L[i - 1]) / Math.max(1e-6, L[i] - L[i - 1]); return [lerp(pts[i - 1][0], pts[i][0], u), lerp(pts[i - 1][1], pts[i][1], u)]; };
  const { lead = 0.3, r = 3.4, gap = 44, speed = 360, a = 1, s = 1 } = o;
  const lp = (t - t0) / lead, reach = tot * E.inOutCubic(clamp(lp));
  K.save(); K.globalAlpha *= a;
  const off = ((t - t0) * speed) % gap;
  for (let d = off; d < reach - 6; d += gap) { const q = at(d); circle(K, q[0], q[1], r, C.red); }
  if (lp < 1.12) {
    const q = at(reach), k = 1 - clamp((lp - 0.9) / 0.22);
    glow(T, q[0], q[1], 70 * s, 70 * s, 0.75 * k * a);
    circle(K, q[0], q[1], r * 3.1 * k, C.red); circle(K, q[0], q[1], r * 1.3 * k, '#FFE1DA');
  }
  K.restore();
}
// halftone-looking drop shadow drawn on K (for props that sit on top of another K card, where a T shadow would be hidden)
let _DOTS = null;
function dotShadow(K, x, y, w, h, r, dense = 1) {
  if (!_DOTS) _DOTS = [1.05, 1.6, 2.05].map(rad => { const c = document.createElement('canvas'); c.width = c.height = 5; const g = c.getContext('2d'); g.fillStyle = '#111111'; g.beginPath(); g.arc(2.5, 2.5, rad, 0, TAU); g.fill(); return c; });
  K.save();
  [[18, 0], [11, 1], [5, 2]].forEach(([grow, k]) => {
    if (k === 2 && dense < 0.6) return;
    fillRR(K, x - grow * 0.5 + 10, y - grow * 0.5 + 16, w + grow, h + grow, r + grow * 0.5, K.createPattern(_DOTS[k], 'repeat'));
  });
  K.restore();
}
// marker underline that sweeps in under a word (p 0..1); slight hand-drawn wobble
function underline(K, x, y, w, p, col = C.red, lw = 10) {
  if (p <= 0) return;
  K.save(); K.strokeStyle = col; K.lineWidth = lw; K.lineCap = 'round';
  K.beginPath(); K.moveTo(x, y); K.quadraticCurveTo(x + w * 0.5, y + 6, x + w * E.outCubic(p), y - 2 + 4 * p); K.stroke(); K.restore();
}
// highlighter block behind text (draw on T with the accent → prints as accent dots; or on K with rgba)
function highlight(ctx, x, y, w, h, p, col = 'rgba(255,0,0,0.55)') { if (p <= 0) return; ctx.save(); ctx.fillStyle = col; ctx.fillRect(x, y, w * E.outCubic(clamp(p)), h); ctx.restore(); }
// hand-drawn loop around a box (cx, cy, rx, ry), drawn on over p 0..1 (overshoots its start like a pen)
function scribbleCircle(K, cx, cy, rx, ry, p, col = C.red, lw = 7, seed = 3) {
  if (p <= 0) return;
  const R = rng(seed), a0 = -2.2 + R() * 0.4, turns = 1.12, N = 60;
  K.save(); K.strokeStyle = col; K.lineWidth = lw; K.lineCap = 'round'; K.lineJoin = 'round'; K.beginPath();
  const n = Math.max(2, Math.floor(N * E.outCubic(clamp(p))));
  for (let i = 0; i <= n; i++) {
    const u = i / N, a = a0 + u * TAU * turns, k = 1 + 0.06 * Math.sin(u * 9 + seed) + 0.05 * u;
    const x = cx + Math.cos(a) * rx * k, y = cy + Math.sin(a) * ry * k;
    i ? K.lineTo(x, y) : K.moveTo(x, y);
  }
  K.stroke(); K.restore();
}
// hand-drawn arrow from (x0,y0) to (x1,y1) with a bend (bend = px sideways), drawn on over p
function arrow(K, x0, y0, x1, y1, p, o = {}) {
  if (p <= 0) return;
  const { col = C.red, lw = 7, bend = 60, head = 26 } = o;
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1;
  const cx = mx - dy / l * bend, cy = my + dx / l * bend;
  const Q = [[x0, y0], [lerp(x0, cx, 0.66), lerp(y0, cy, 0.66)], [lerp(x1, cx, 0.66), lerp(y1, cy, 0.66)], [x1, y1]];
  cable(K, Q, clamp(p * 1.25), col, lw);
  const hp = clamp((p - 0.75) / 0.25);
  if (hp > 0) {
    const [ax, ay] = bez(Q, 0.96), ang = Math.atan2(y1 - ay, x1 - ax), h = head * E.outBack(hp);
    K.save(); K.strokeStyle = col; K.lineWidth = lw; K.lineCap = 'round'; K.lineJoin = 'round'; K.beginPath();
    K.moveTo(x1 + Math.cos(ang + 2.5) * h, y1 + Math.sin(ang + 2.5) * h); K.lineTo(x1, y1); K.lineTo(x1 + Math.cos(ang - 2.5) * h, y1 + Math.sin(ang - 2.5) * h);
    K.stroke(); K.restore();
  }
}
// confetti / paper bits burst (accent + ink), dt = t - burst time
function confetti(K, x, y, dt, o = {}) {
  const { n = 26, spread = 520, seed = 5, dur = 1.1 } = o;
  if (dt < 0 || dt > dur) return;
  const R = rng(seed);
  for (let i = 0; i < n; i++) {
    const ang = -Math.PI * (0.1 + 0.8 * R()), v = spread * (0.6 + 0.8 * R()), spin = (R() - 0.5) * 18, w = 10 + R() * 12, col = R() < 0.6 ? C.red : C.ink;
    const px = x + Math.cos(ang) * v * dt, py = y + Math.sin(ang) * v * dt + 1300 * dt * dt;
    K.save(); K.globalAlpha *= 1 - clamp((dt - dur * 0.6) / (dur * 0.4)); K.translate(px, py); K.rotate(spin * dt + i);
    K.fillStyle = col; K.fillRect(-w / 2, -w * 0.3, w, w * 0.6); K.restore();
  }
}
// ripple rings at a click point
function ripple(K, x, y, dt, col = C.red) {
  for (let i = 0; i < 2; i++) { const d = dt - i * 0.1; if (d < 0 || d > 0.45) continue; const p = d / 0.45; K.save(); K.globalAlpha *= 1 - p; circle(K, x, y, 14 + 60 * E.outCubic(p), null, col, 4 * (1 - p) + 1); K.restore(); }
}
// motion speed lines behind a moving object (direction ang in rad), a = 0..1
function speedLines(K, x, y, ang, a, o = {}) {
  if (a <= 0.01) return;
  const { n = 5, len = 160, gap = 26, col = C.ink, lw = 5, seed = 2 } = o, R = rng(seed);
  K.save(); K.globalAlpha *= a; K.strokeStyle = col; K.lineWidth = lw; K.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * gap, l = len * (0.5 + R() * 0.5), bx = x - Math.cos(ang) * (40 + R() * 40) - Math.sin(ang) * off, by = y - Math.sin(ang) * (40 + R() * 40) + Math.cos(ang) * off;
    K.beginPath(); K.moveTo(bx, by); K.lineTo(bx - Math.cos(ang) * l, by - Math.sin(ang) * l); K.stroke();
  }
  K.restore();
}
