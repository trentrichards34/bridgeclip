// ───────────────────────── charts kit: bars, line, ring, before/after ─────────────────────────
// Bars grow with a spring, values roll, the ONE bar that matters is accent, the rest are printed grey dots with ink outlines.
// Charts draw everything on K (dot patterns instead of tone fills) so they also work INSIDE cards/windows, where T is covered.

// a halftone-dot fill pattern on K (cached): dotPattern(K, '#111111', 1.6) → use as fillStyle. cell 5 px like the shader.
const _PATS = {};
function dotPattern(K, col = '#111111', rad = 1.6) {
  const key = col + rad;
  if (!_PATS[key]) { const c = document.createElement('canvas'); c.width = c.height = 5; const g = c.getContext('2d'); g.fillStyle = col; g.beginPath(); g.arc(2.5, 2.5, rad, 0, TAU); g.fill(); _PATS[key] = c; }
  return K.createPattern(_PATS[key], 'repeat');
}

// bar chart in box (x, y, w, h). bars: [{ v, label, hot, t0 }]  (t0 = when that bar grows; default o.t0 + i*0.08)
// o: { t, t0, max, fmt: v => string, gap: 0.28 }
function barChart(T, K, x, y, w, h, bars, o = {}) {
  const t = o.t ?? 0, n = bars.length, gap = o.gap ?? 0.28, bw = w / (n + (n - 1) * gap), max = o.max || Math.max(...bars.map(b => b.v)) || 1;
  const base = y + h - 56;
  line(K, x - 10, base, x + w + 10, base, C.ink, 4, 'round');
  bars.forEach((b, i) => {
    const t0 = b.t0 ?? (o.t0 ?? 0) + i * 0.08, g = clamp(pop(t - t0, 2.2, 0.55), 0, 1.15), bh = (h - 140) * (b.v / max) * g;
    const bx = x + i * bw * (1 + gap);
    if (bh > 1) {
      fillRR(K, bx, base - bh, bw, bh + 6, 10, '#FFFFFF');
      fillRR(K, bx, base - bh, bw, bh + 6, 10, dotPattern(K, b.hot ? C.red : '#111111', b.hot ? 2.1 : 1.1));
      strokeRR(K, bx, base - bh, bw, bh + 6, 10, b.hot ? C.red : C.ink, 4);
      if (g > 0.3) {
        const fmt = o.fmt || (v => String(Math.round(v)));
        text(K, fmt(b.v * Math.min(1, g)), bx + bw / 2, base - bh - 18, { font: F.grot, weight: 700, size: Math.min(48, bw * 0.42), color: b.hot ? C.red : C.ink });
      }
    }
    if (b.label) text(K, b.label, bx + bw / 2, base + 40, { font: F.mono, weight: 500, size: Math.min(24, bw * 0.24), color: b.hot ? C.red : '#8a8780' });
  });
}
// line chart: pts = [v0, v1, ...] drawn on over p (0..1) in box; area under the line in halftone grey. o: { max, min, hotLast }
function lineChart(T, K, x, y, w, h, pts, p, o = {}) {
  const max = o.max ?? Math.max(...pts), min = o.min ?? Math.min(0, ...pts), n = pts.length;
  const P2 = pts.map((v, i) => [x + w * i / (n - 1), y + h - (v - min) / (max - min || 1) * h]);
  const k = clamp(p) * (n - 1), i0 = Math.floor(k), u = k - i0;
  const vis = P2.slice(0, i0 + 1); if (i0 < n - 1) vis.push([lerp(P2[i0][0], P2[i0 + 1][0], u), lerp(P2[i0][1], P2[i0 + 1][1], u)]);
  if (vis.length < 2) return;
  K.beginPath(); K.moveTo(vis[0][0], y + h); vis.forEach(q => K.lineTo(q[0], q[1])); K.lineTo(vis[vis.length - 1][0], y + h); K.closePath(); K.fillStyle = dotPattern(K, '#111111', 1.1); K.fill();
  K.save(); K.strokeStyle = C.ink; K.lineWidth = 7; K.lineJoin = 'round'; K.lineCap = 'round'; K.beginPath(); vis.forEach((q, j) => j ? K.lineTo(q[0], q[1]) : K.moveTo(q[0], q[1])); K.stroke(); K.restore();
  const end = vis[vis.length - 1];
  circle(K, end[0], end[1], 14, o.hotLast === false ? C.ink : C.red, '#FFFFFF', 5);
  line(K, x, y + h, x + w, y + h, C.ink, 4, 'round');
}
// progress ring (donut) centred at x,y radius r; p 0..1; label in the middle
function ringChart(T, K, x, y, r, p, o = {}) {
  const lw = o.lw || r * 0.22;
  K.save(); K.lineWidth = lw; K.strokeStyle = dotPattern(K, '#111111', 1.2); K.beginPath(); K.arc(x, y, r, 0, TAU); K.stroke(); K.restore();
  K.save(); K.lineWidth = lw; K.lineCap = 'round'; K.strokeStyle = o.col || C.red;
  if (p > 0.001) { K.beginPath(); K.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(p)); K.stroke(); }
  K.restore();
  if (o.label !== false) text(K, o.label || Math.round(p * 100) + '%', x, y + r * 0.2, { font: F.grot, weight: 700, size: r * 0.55, color: C.ink, ls: -r * 0.02 });
}
// before / after split card: two halves; the divider wipes from left (p 0..1) revealing `after`. drawA/drawB(K, x, y, w, h)
function beforeAfter(T, K, x, y, w, h, p, drawA, drawB, o = {}) {
  uiCard(T, K, x, y, w, h, { r: 28 });
  const sx = x + w * clamp(p);
  K.save(); rr(K, x, y, w, h, 28); K.clip();
  K.save(); K.beginPath(); K.rect(sx, y, x + w - sx, h); K.clip(); drawA(K, x, y, w, h); K.restore();
  K.save(); K.beginPath(); K.rect(x, y, sx - x, h); K.clip(); drawB(K, x, y, w, h); K.restore();
  K.restore();
  if (p > 0.001 && p < 0.999) { line(K, sx, y - 10, sx, y + h + 10, C.red, 6, 'round'); circle(K, sx, y + h / 2, 22, C.red); text(K, '↔', sx, y + h / 2 + 9, { font: F.grot, weight: 700, size: 26, color: '#FFFFFF' }); }
  if (p < 0.85) text(K, o.a || 'BEFORE', x + w - 28, y + 46, { font: F.mono, weight: 700, size: 22, color: '#8a8780', align: 'right' });
  if (p > 0.15) text(K, o.b || 'AFTER', x + 28, y + 46, { font: F.mono, weight: 700, size: 22, color: C.red, align: 'left' });
}
// versus: two stacked option rows with a winner (0 or 1) stamped at tWin. rows: [{label, value}] ; o: { t, tWin, winner }
function versus(T, K, x, y, w, rows, o = {}) {
  const t = o.t ?? 0, rh = 130;
  rows.forEach((r, i) => {
    const ry = y + i * (rh + 26), win = t >= (o.tWin ?? 1e9) && i === (o.winner ?? 0), lose = t >= (o.tWin ?? 1e9) && !win;
    uiCard(T, K, x, ry, w, rh, { r: 26, border: win ? C.red : HAIR, lw: win ? 4 : 3 });
    K.save(); K.globalAlpha *= lose ? 0.45 : 1;
    text(K, r.label, x + 34, ry + rh / 2 + 14, { font: F.grot, weight: 700, size: 40, color: C.ink, align: 'left', ls: -1 });
    if (r.value) text(K, r.value, x + w - 34, ry + rh / 2 + 14, { font: F.grot, weight: 700, size: 40, color: win ? C.red : C.ink, align: 'right' });
    K.restore();
    if (lose) cross(K, x + w - 60, ry + rh / 2, 50, clamp((t - o.tWin) / 0.25), C.red, 8);
  });
}
