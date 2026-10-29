// ── ILLUSTRATED EXAMPLE · STORE FLOOR PLAN with a one-way route and a walking shopper (studied from a reel about a furniture
// megastore that makes you walk through every showroom; de-branded, generic rooms and colours)
// WHAT it shows: an aerial plan you can read in one second: rooms with furniture, a red route snaking through ALL of them,
// IN and EXIT on the same wall, a tiny shopper walking it, shortcut doors that open then get X'd shut.
// TECHNIQUES inside (guides/illustration.md):
//   · top-down furniture glyphs (sofa, bed, counter, table, desk, shelf, bath...): each is 2-4 rounded rects with ONE darker part
//     (cushions, headboard, sink) + a plant dot: icon simplicity, real proportions, still reads as "a real room"
//   · the route = a Catmull-Rom spline through hand-placed points, resampled once at load with arc length (fpPathAt(u) gives an
//     even-speed point + heading); drawn as a soft wide glow + a marching red dash + chevrons that slide along it
//   · the walker = illustrate.js tinyPerson placed with fpPathAt(walk), kept UPRIGHT when the plan is rotated (counter-rotate)
//   · walls drawn LAST as thick round-capped ink lines with gaps for doors; shortcut doors = gaps that open (o.cuts) and red X
//     badges that slam with pop() (o.cutX = seconds since each slam)
//   · rot: the same art turned (portrait 0°, landscape -90°) while labels and the walker stay upright
// API: floorPlan(ctx, x, y, s, o) CENTRED at (x, y) · floorPlanArt(ctx, o) (origin = floor centre) · fpPathAt(u) → {x, y, a} · PLAN_BOX
//      o: { t, path 0..1 (route drawn so far), from 0..1, walk 0..1 | null, walkerS, cuts [a, b, c] 0..1, cutX [dt, dt, dt],
//           exitGlow 0..1, rot deg, noShadow }
// DON'T paste this as your reel's prop: draw THIS script's subject with the same method. Not loaded by the engine. Needs kits/illustrate.js.

var PLAN_BOX = [-240, -242, 192, 246];
function floorPlan(ctx, x, y, s = 1, o = {}) { ctx.save(); ctx.translate(x, y); ctx.scale(s, s); floorPlanArt(ctx, o); ctx.restore(); }

var FP_PTS = [[-236, -172.5], [-180, -172.5], [-122, -160], [-60, -172.5], [0, -185], [60, -172.5], [112, -160], [148, -150], [150, -115],
  [142, -76], [100, -57.5], [60, -57.5], [0, -45], [-60, -57.5], [-110, -70], [-146, -40], [-150, 0],
  [-140, 36], [-96, 74], [-40, 40], [20, 76], [80, 40], [130, 64], [150, 115],
  [138, 152], [100, 172.5], [40, 172.5], [-20, 172.5], [-80, 172.5], [-130, 172.5], [-180, 172.5], [-236, 172.5]];
var FP_PATH = (() => {                                                   // Catmull-Rom → dense points with arc length s
  const P = FP_PTS, pts = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    for (let k = 0; k < 12; k++) {
      const s = k / 12, s2 = s * s, s3 = s2 * s;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * s + (2 * a - 5 * b + 4 * c - d) * s2 + (-a + 3 * b - 3 * c + d) * s3);
      pts.push({ x: f(p0[0], p1[0], p2[0], p3[0]), y: f(p0[1], p1[1], p2[1], p3[1]) });
    }
  }
  pts.push({ x: P[P.length - 1][0], y: P[P.length - 1][1] });
  let L = 0; pts.forEach((p, i) => { if (i) L += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y); p.s = L; });
  return { pts, L };
})();
function fpPathAt(u) {
  const { pts, L } = FP_PATH, s = clamp(u) * L;
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m].s < s) lo = m; else hi = m; }
  const a = pts[lo], b = pts[hi], f = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
  return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), a: Math.atan2(b.y - a.y, b.x - a.x) };
}
var FP_CUTS = [{ x0: -50, x1: -14, y: -115 }, { x0: 12, x1: 48, y: 0 }, { x0: -50, x1: -14, y: 115 }];
var FP_OUT = 'rgba(35,35,45,0.55)', FP_WOOD = '#D8B47F', FP_WOODD = '#B08552', FP_FAB = '#8F9EAD';
function fpBox(K, x, y, w, h, r, fill) { fillRR(K, x, y, w, h, r, fill); strokeRR(K, x, y, w, h, r, FP_OUT, 1.2); }
var FP_FUR = {                                                             // top-down furniture glyphs, centred
  sofa(K, x, y, f) { fpBox(K, x - 34, y - 12, 68, 24, 6, FP_FAB); fillRR(K, x - 34, f > 0 ? y - 12 : y + 4, 68, 8, 4, shade(FP_FAB, 0.8)); fillRR(K, x - 34, y - 12, 8, 24, 4, shade(FP_FAB, 0.8)); fillRR(K, x + 26, y - 12, 8, 24, 4, shade(FP_FAB, 0.8)); line(K, x, y - 4, x, y + 4, 'rgba(255,255,255,0.5)', 1.2); },
  chair(K, x, y) { fillRR(K, x - 22, y - 13, 50, 26, 4, '#E7D9C2'); for (let i = 0; i < 4; i++) fillRR(K, x - 18 + i * 12, y - 13, 5, 26, 0, 'rgba(200,120,60,0.35)'); fpBox(K, x - 46, y - 11, 22, 22, 6, '#D98C5F'); circle(K, x + 38, y, 7, '#F4E9C8', FP_OUT, 1.2); },
  bed(K, x, y) { fpBox(K, x - 36, y - 13, 72, 26, 3, '#FFFFFF'); fillRR(K, x - 36, y - 13, 6, 26, 2, FP_WOODD); fillRR(K, x - 28, y - 10, 12, 9, 3, '#EDEDED'); fillRR(K, x - 28, y + 1, 12, 9, 3, '#EDEDED'); fillRR(K, x - 10, y - 13, 46, 26, 3, '#9DB8A6'); line(K, x - 10, y - 13, x - 10, y + 13, '#7E9C88', 1.5); fpBox(K, x + 40, y - 9, 10, 10, 2, FP_WOOD); },
  wardrobe(K, x, y) { fpBox(K, x - 38, y - 8, 76, 16, 2, '#EFEDE8'); for (let i = 1; i < 4; i++) line(K, x - 38 + i * 19, y - 8, x - 38 + i * 19, y + 8, 'rgba(0,0,0,0.25)', 1); circle(K, x + 46, y, 6, '#5BA04A'); },
  counter(K, x, y) { fpBox(K, x - 46, y - 9, 92, 18, 2, '#E9E5DD'); fillRR(K, x - 30, y - 6, 18, 12, 3, '#B9C3CC'); for (let i = 0; i < 4; i++) circle(K, x + 12 + (i % 2) * 11, y - 3 + Math.floor(i / 2) * 7, 3, null, '#55575E', 1.4); },
  dining(K, x, y) { for (const cx of [-14, 0, 14]) { fillRR(K, x + cx - 4, y - 15, 8, 6, 2, FP_WOODD); fillRR(K, x + cx - 4, y + 9, 8, 6, 2, FP_WOODD); } fpBox(K, x - 24, y - 8, 48, 16, 3, FP_WOOD); circle(K, x, y, 3, '#5BA04A'); },
  desk(K, x, y) { fpBox(K, x - 26, y - 9, 52, 18, 2, '#F2F1EE'); fillRR(K, x - 8, y - 6, 16, 4, 1, '#3A3D44'); circle(K, x, y + 14, 6, '#3A3D44'); fpBox(K, x + 34, y - 9, 12, 18, 2, FP_WOOD); },
  shelf(K, x, y) { fpBox(K, x - 40, y - 7, 80, 14, 1, FP_WOOD); for (let i = 0; i < 9; i++) fillRR(K, x - 37 + i * 8.6, y - 5, 5, 10, 1, ['#C0392B', '#3E6D8E', '#E0A84E', '#3E8E5E', '#8E6BB0'][i % 5]); },
  kids(K, x, y) { circle(K, x - 18, y, 13, '#F4C7C3', FP_OUT, 1.2); circle(K, x - 18, y, 7, '#FFE58A'); fillRR(K, x + 2, y - 6, 9, 9, 2, '#E2231A'); fillRR(K, x + 14, y - 2, 9, 9, 2, '#E0A84E'); fillRR(K, x + 8, y + 5, 9, 9, 2, '#3E6D8E'); circle(K, x + 34, y, 6, '#5BA04A'); },
  toys(K, x, y) { fpBox(K, x - 30, y - 8, 60, 16, 3, '#FFFFFF'); for (let i = 0; i < 4; i++) fillRR(K, x - 26 + i * 14, y - 5, 10, 10, 2, ['#E2231A', '#E0A84E', '#3E6D8E', '#5BA04A'][i]); },
  bath(K, x, y) { fpBox(K, x - 32, y - 12, 50, 24, 10, '#FFFFFF'); fillRR(K, x - 28, y - 8, 42, 16, 7, '#BFE0F2'); fpBox(K, x + 26, y - 8, 16, 16, 4, '#FFFFFF'); },
  sink(K, x, y) { fpBox(K, x - 30, y - 8, 36, 16, 3, '#E9E5DD'); fillRR(K, x - 20, y - 5, 16, 10, 4, '#BFE0F2'); circle(K, x + 22, y, 8, '#4E9A45'); circle(K, x + 20, y - 2, 4, '#7CC163'); },
};
var FP_ROOMS = [[-120, -172.5, 'sofa', 'chair', '#F4EDDD'], [0, -172.5, 'bed', 'wardrobe', '#EFE6D2'], [120, -172.5, 'counter', 'dining', '#F3EFE6'],
  [120, -57.5, 'desk', 'shelf', '#EEE8DA'], [0, -57.5, 'kids', 'toys', '#F6ECE6'], [-120, -57.5, 'bath', 'sink', '#EAF0F2']];
var FP_BINS = ['#E2231A', '#F2B134', '#4E9BD6', '#6DBB63', '#FFFFFF', '#C97BB0', '#F08A4B'];

function floorPlanArt(K, o = {}) {
  const t = o.t || 0, rot = (o.rot || 0) * D2R;
  K.save(); K.rotate(rot);
  const up = (x, y, fn) => { K.save(); K.translate(x, y); K.rotate(-rot); fn(); K.restore(); };      // upright labels / walker
  if (!o.noShadow) fillRR(K, -180 + 8, -230 + 11, 360, 460, 16, 'rgba(20,20,30,0.2)');
  fillRR(K, -180, -230, 360, 460, 16, '#F7F3EA');
  for (const [cx, cy, a, b, col] of FP_ROOMS) { fillRR(K, cx - 60, cy - 57.5, 120, 115, 0, col); FP_FUR[a](K, cx, cy - 39, 1); FP_FUR[b](K, cx, cy + 40, -1); }
  fillRR(K, -180, 0, 360, 115, 0, '#F1ECE2');                                // market hall: bins along both walls
  for (let k = 0; k < 2; k++) for (let i = 0; i < 12; i++) {
    const bx = -160 + i * 29, by = k ? 101 : 15, c = FP_BINS[(i * 3 + k * 5) % FP_BINS.length];
    circle(K, bx, by, 10, shade(c, 1.75), FP_OUT, 1.2); circle(K, bx - 3, by - 2, 3.4, c); circle(K, bx + 3, by + 1, 3.4, c); circle(K, bx, by + 4, 3, shade(c, 0.85));
  }
  fillRR(K, -180, 115, 360, 115, 0, '#E8E5DE');                              // warehouse racks + checkouts
  for (const ry of [121, 207]) {
    fillRR(K, -42, ry, 220, 18, 0, '#D9D6CF');
    for (let i = 0; i < 9; i++) fillRR(K, -38 + i * 24, ry + 3, 18, 12, 1, i % 3 === 1 ? '#C7995F' : '#D3A86E');
    line(K, -42, ry + 1, 178, ry + 1, '#E8792B', 2.2); line(K, -42, ry + 17, 178, ry + 17, '#E8792B', 2.2);
    for (let i = 0; i <= 9; i++) fillRR(K, -43 + i * 24, ry - 1, 4, 20, 1, '#5A6470');
  }
  for (const cx of [-112, -82]) { fpBox(K, cx - 6, 128, 12, 30, 2, '#DCD7CC'); fillRR(K, cx - 3, 131, 6, 24, 1, '#55575E'); fpBox(K, cx - 6, 188, 12, 30, 2, '#DCD7CC'); fillRR(K, cx - 3, 191, 6, 24, 1, '#55575E'); }
  const pp = o.path == null ? 1 : clamp(o.path), p0 = clamp(o.from || 0);   // the one-way route
  if (pp > p0) {
    const { pts, L } = FP_PATH, s0 = p0 * L, s1 = pp * L, e0 = fpPathAt(p0), e1 = fpPathAt(pp);
    K.beginPath(); K.moveTo(e0.x, e0.y); for (const p of pts) { if (p.s <= s0) continue; if (p.s >= s1) break; K.lineTo(p.x, p.y); } K.lineTo(e1.x, e1.y);
    K.save(); K.lineCap = 'round'; K.lineJoin = 'round';
    K.strokeStyle = 'rgba(255,59,31,0.17)'; K.lineWidth = 15; K.stroke();
    K.setLineDash([10, 7]); K.lineDashOffset = -t * 26; K.strokeStyle = C.red; K.lineWidth = 4.2; K.stroke();
    K.restore();
    const SP = 44, off = (t * 26) % SP;
    for (let s = s0 + off + 16; s < s1 - 8; s += SP) { const q = fpPathAt(s / L); X([K], q.x, q.y, 1, q.a / D2R, () => fillPoly(K, [[7, 0], [-5, -6.5], [-2, 0], [-5, 6.5]], C.red)); }
    if (pp < 0.999) X([K], e1.x, e1.y, 1, e1.a / D2R, () => fillPoly(K, [[11, 0], [-5, -9], [-5, 9]], C.red));
  }
  const cuts = o.cuts || [0, 0, 0];                                          // walls (drawn last), with door gaps
  K.save(); K.strokeStyle = '#2B2C33'; K.lineCap = 'round';
  const seg = (x1, y1, x2, y2, lw = 5) => { K.lineWidth = lw; K.beginPath(); K.moveTo(x1, y1); K.lineTo(x2, y2); K.stroke(); };
  const part = (y, xa, xb) => { let x = xa; FP_CUTS.forEach((c, i) => { if (c.y !== y) return; const op = clamp(cuts[i] || 0), m = (c.x0 + c.x1) / 2, hw = (c.x1 - c.x0) / 2 * op; seg(x, y, m - hw, y); x = m + hw; }); seg(x, y, xb, y); };
  part(-115, -180, 118); part(0, -118, 180); part(115, -180, 118);
  for (const dx of [-60, 60]) for (const c of [-172.5, -57.5]) { seg(dx, c - 57.5, dx, c - 23); seg(dx, c + 23, dx, c + 57.5); }
  seg(-180, -230, 180, -230, 8); seg(180, -230, 180, 230, 8); seg(180, 230, -180, 230, 8);
  seg(-180, -230, -180, -196, 8); seg(-180, -149, -180, 149, 8); seg(-180, 196, -180, 230, 8);
  K.restore();
  FP_CUTS.forEach((c, i) => {                                                // shortcut doors + the red X that shuts each
    const op = clamp(cuts[i] || 0), m = (c.x0 + c.x1) / 2;
    if (op > 0.02) { K.save(); K.globalAlpha *= op; K.setLineDash([5, 4]); K.lineDashOffset = -t * 20; K.strokeStyle = '#E0A800'; K.lineWidth = 3.4; K.lineCap = 'round'; K.beginPath(); K.moveTo(m, c.y - 22); K.lineTo(m, c.y + 22); K.stroke(); K.restore(); }
    const dx = (o.cutX || [])[i];
    if (dx != null && dx >= 0) { const s = clamp(pop(dx, 3.2, 0.45), 0, 1.3); up(m, c.y, () => X([K], 0, 0, s * (1 + 0.6 * (1 - clamp(dx / 0.12))), 0, () => { circle(K, 0, 0, 15, '#FFFFFF', C.red, 3.5); cross(K, 0, 0, 13, 1, C.red, 4.5); })); }
  });
  up(-208, -197, () => text(K, 'IN', 0, 0, { font: F.mono, weight: 700, size: 17, color: '#1B1C22' }));
  const eg = clamp(o.exitGlow || 0), es = 1 + 0.18 * eg * (0.6 + 0.4 * Math.sin(t * 12));
  up(-208, 141, () => X([K], 0, 0, es, 0, () => {
    if (eg > 0) { K.save(); K.globalAlpha *= eg * 0.5; fillRR(K, -36, -17, 72, 34, 10, '#7EE0A8'); K.restore(); }
    fillRR(K, -29, -12, 58, 24, 5, '#1E9E5A'); strokeRR(K, -29, -12, 58, 24, 5, '#FFFFFF', 2);
    text(K, 'EXIT', 0, 7, { font: ILL_SANS, weight: 800, size: 16, color: '#FFFFFF', ls: 1 });
  }));
  if (o.walk != null) {
    const q = fpPathAt(o.walk), ws = o.walkerS || 1.3;
    up(q.x, q.y + 4, () => tinyPerson(K, 0, 0, ws, { ph: t * 13, flip: Math.cos(q.a + rot) < -0.2, walking: o.walk < 0.999, shirt: '#3E6D8E', bag: '#E0A84E' }));
  }
  K.restore();
}
