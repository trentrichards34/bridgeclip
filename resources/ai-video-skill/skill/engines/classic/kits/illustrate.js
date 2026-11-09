// ───────────────────────── illustrate kit: drawing PRIMITIVES for real-looking subjects ─────────────────────────
// When the script is about a REAL place, product, company or object (a restaurant, a store, a burger, a car, a city block, a floor
// plan, a phone playing a video), draw it like real life, not as a flat icon: real proportions, an isometric or 3/4 construction,
// three tones per surface + a highlight + an edge line, the signature details that make it recognisable, and small signs of life.
// Method, per-category detail lists, checklist: guides/illustration.md. Finished, de-branded examples built ONLY on this kit:
// library/classic/illustrated/ (study them, then draw THIS script's subject).
// Generic and brand-free on purpose: no logos, no wordmarks. Everything is a pure function of its arguments (and t): no Math.random.
// Only `function` and `var` at top level, so loading this file twice (index.html + SCENE_FILES) is harmless.
//
// Layers (guides/styles/classic.md §3): draw the illustration itself on K (crisp ink layer). On open paper, put its CONTACT SHADOW on
// T (`softShadow(T, ...)`, `dieCut(K, ..., { T })`) so it prints as halftone dots like every other classic shadow. Shadows that fall
// ON the illustration's own surfaces (a building's shadow on its parking lot) stay on K as rgba. Inside a phone/card/panel content
// callback T is hidden: draw everything (shadows too) on K.
//
// API (ctx = the canvas you draw on, usually K; scene units):
//  1 · colour      shade(col, k) (k < 1 darker, k > 1 toward white) · mixCol(a, b, f) · withAlpha(col, a) · tones(col) → {top, left, right, edge}
//  2 · light       vGrad / hGrad(ctx, a, b, cols) · roundGrad(ctx, cx, cy, r, col) (volume of round things) · cylGrad(ctx, x0, x1, col)
//                  (poles, cans, cups) · gloss(ctx, x, y, rx, ry, rot, a) (specular highlight) · glassStreak(ctx, x, y, w, h, a)
//  3 · shadows     softShadow(ctx, x, y, rx, ry, a, rgb) (contact shadow; on T → halftone) · isoCastShadow(ctx, x0, y0, x1, y1, h, a, k)
//  4 · isometric   ISO(x, y, z) → [sx, sy] (2:1 iso: x → right-down, y → left-down, z up; visible faces = front-left (y max),
//                  right (x max), top) · poly / fillPoly / edgePoly(ctx, pts, ...) · isoLeft(ctx, y, fn) / isoRight(ctx, x, fn) /
//                  isoTop(ctx, z, fn) (draw ON a face in its own flat coords) · isoQuad(ctx, x0, y0, x1, y1, z, fill) ·
//                  isoPath(ctx, [[x, y]...], z, col, lw, {dash, offset}) · isoBox(ctx, x0, y0, x1, y1, z0, z1, col, {edge, lw, top, left, right})
//                  · isoPrism(ctx, x0, y0, x1, y1, z, rise, col, {ridge 'x'|'y', edge}) (gable roof) · isoCylinder(ctx, x, y, r, z0, z1, col, {edge})
//                  · isoSlab(ctx, x0, y0, x1, y1, depth, {top, side, lip, shadow, specks}) (diorama ground tile)
//  5 · windows     litWindow(ctx, x, y, w, h, {seed, people, mull, lit, frame}) · windowGrid(ctx, x, y, w, h, cols, rows, {t, seed, on, gap, frame})
//                  · awning(ctx, x, y, w, h, [colA, colB], {n, scallop})
//  6 · life        isoTree(ctx, x, y, s, {t, col}) · isoCar(ctx, x, y, dir 'x'|'y', col, {brake, s}) · tinyPerson(ctx, x, y, s, {ph, walking,
//                  flip, shirt, pants, skin, hair, bag}) · isoPerson(ctx, x, y, s, o) · poleSign(ctx, bx, by, h, {p, w, h, col, draw(ctx, w, h)})
//                  · steam(ctx, x, y, t, {n, h, a, col})
//  7 · stickers    placeArt(ctx, box, x, y, s, fn) (bottom-centre placement of a drawer with natural bounds box = [x0, y0, x1, y1]) ·
//                  dieCut(ctx, box, fn, {pad, border, shadow: [dx, dy, a], T, cache}) · sticker(ctx, box, x, y, s, fn, o)
//  8 · playing reel shotClock(t, shots, loop, off) · shotCam(lt, shots, w, {hot}) · whipStreaks(ctx, x, y, w, h, k, seed) ·
//                  reelCaption(ctx, cx, cy, u, maxW, words, d, {scale, dark}) · voiceEnv(lt, onsets) · voiceWave(ctx, t, lt, x0, x1, y, u, onsets, {dark, p})
//                  · reelOverlay(ctx, t, x, y, w, h, u, {handle, a, progress, counts}) · miniGuy(ctx, t, x, y, s, pose)
// Guide: guides/illustration.md · studied, de-branded drawers built on this kit: library/classic/illustrated/ (listed in library/classic/INDEX.md).

var ILL_SANS = '"Inter", "Fallback"';

// ═════════════ 1 · colour ═════════════
function _illRGB(c) {
  if (Array.isArray(c)) return c;
  c = String(c).trim();
  if (c[0] === '#') {
    let h = c.slice(1); if (h.length === 3) h = h.split('').map(q => q + q).join('');
    const n = parseInt(h.slice(0, 6), 16); return [n >> 16, (n >> 8) & 255, n & 255];
  }
  const m = c.match(/rgba?\(([^)]+)\)/); if (m) return m[1].split(',').slice(0, 3).map(Number);
  return [128, 128, 128];
}
function _illHex(c) { return '#' + c.map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join(''); }
// k < 1 darkens (multiplies), k > 1 lightens toward white (k = 2 → white)
function shade(col, k) { return _illHex(_illRGB(col).map(v => k >= 1 ? v + (255 - v) * (k - 1) : v * k)); }
function mixCol(a, b, f) { const A = _illRGB(a), B = _illRGB(b); return _illHex(A.map((v, i) => lerp(v, B[i], clamp(f)))); }
function withAlpha(col, a) { const c = _illRGB(col); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }
// the three faces of a lit box (light from the upper left front) + an edge line colour
function tones(col) { return { top: shade(col, 1.14), left: col, right: shade(col, 0.76), edge: withAlpha(shade(col, 0.35), 0.55) }; }

// ═════════════ 2 · light: gradients and highlights ═════════════
function _illStops(g, cols) { cols.forEach((c, i) => Array.isArray(c) ? g.addColorStop(c[0], c[1]) : g.addColorStop(cols.length > 1 ? i / (cols.length - 1) : 0, c)); return g; }
function vGrad(ctx, y0, y1, cols) { return _illStops(ctx.createLinearGradient(0, y0, 0, y1), cols); }
function hGrad(ctx, x0, x1, cols) { return _illStops(ctx.createLinearGradient(x0, 0, x1, 0), cols); }
// volume of a round thing (bun, fruit, ball, dome): light spot upper left, core colour, darker rim
function roundGrad(ctx, cx, cy, r, col) {
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.45, r * 0.05, cx - r * 0.1, cy - r * 0.1, r * 1.15);
  return _illStops(g, [[0, shade(col, 1.45)], [0.3, shade(col, 1.12)], [0.7, col], [1, shade(col, 0.68)]]);
}
// cylinders seen from the side (poles, cans, cups, bottles): dark edge, light band at ~30 %, dark edge
function cylGrad(ctx, x0, x1, col) { return hGrad(ctx, x0, x1, [[0, shade(col, 0.62)], [0.3, shade(col, 1.35)], [0.55, col], [1, shade(col, 0.55)]]); }
// specular highlight (glossy plastic, buns, glass, car roofs)
function gloss(ctx, x, y, rx, ry, rot = -0.35, a = 0.38) {
  ctx.save(); ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, TAU); ctx.fill();
  ctx.fillStyle = `rgba(255,255,255,${a * 0.6})`; ctx.beginPath(); ctx.ellipse(x - rx * 0.75, y + ry * 2.2, rx * 0.28, ry * 0.45, rot - 0.3, 0, TAU); ctx.fill(); ctx.restore();
}
// a diagonal reflection band across a pane of glass (clipped to the pane)
function glassStreak(ctx, x, y, w, h, a = 0.3) {
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.fillStyle = `rgba(255,255,255,${a})`;
  const k = h * 0.5, bw = Math.max(2, w * 0.08);
  ctx.beginPath(); ctx.moveTo(x + w * 0.15, y + h); ctx.lineTo(x + w * 0.15 + k, y); ctx.lineTo(x + w * 0.15 + k + bw, y); ctx.lineTo(x + w * 0.15 + bw, y + h); ctx.fill();
  ctx.globalAlpha *= 0.5; ctx.beginPath(); ctx.moveTo(x + w * 0.15 + bw * 2, y + h); ctx.lineTo(x + w * 0.15 + k + bw * 2, y); ctx.lineTo(x + w * 0.15 + k + bw * 2.6, y); ctx.lineTo(x + w * 0.15 + bw * 2.6, y + h); ctx.fill();
  ctx.restore();
}

// ═════════════ 3 · shadows ═════════════
// soft contact shadow under an object (dense core, soft edge). On T it prints as halftone dots (use rgb '0,0,0').
function softShadow(ctx, x, y, rx, ry, a = 0.24, rgb = '20,15,10') {
  if (a <= 0.003 || rx <= 0) return;
  ctx.save(); ctx.translate(x, y); ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(0.62, `rgba(${rgb},${a * 0.8})`); g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.fill(); ctx.restore();
}
// the shadow an iso box of height h casts on the ground (light from the front left, shadow falls back-right). k = length per height.
function isoCastShadow(ctx, x0, y0, x1, y1, h, a = 0.2, k = 0.65) {
  const s = h * k;
  fillPoly(ctx, [ISO(x0, y1), ISO(x1, y1), ISO(x1 + s, y1 - s), ISO(x1 + s, y0 - s), ISO(x0 + s, y0 - s), ISO(x0, y0)], `rgba(15,20,30,${a})`);
}

// ═════════════ 4 · isometric construction ═════════════
function ISO(x, y, z = 0) { return [(x - y) * 0.866, (x + y) * 0.5 - z]; }
function poly(ctx, pts, close = true) { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); if (close) ctx.closePath(); }
function fillPoly(ctx, pts, fill) { poly(ctx, pts); ctx.fillStyle = fill; ctx.fill(); }
function edgePoly(ctx, pts, col, lw = 1.4, open = false) { poly(ctx, pts, !open); ctx.save(); ctx.lineWidth = lw; ctx.strokeStyle = col; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(); ctx.restore(); }
// draw ON a face in its own flat coordinates (signs, windows, doors, stripes, texture):
//   isoLeft(ctx, y, fn)  the front-left face at y = const: local (x, -z)  → fillRect(x0, -z1, w, h) is a band from z1 down
//   isoRight(ctx, x, fn) the right face at x = const:      local (-y, -z)
//   isoTop(ctx, z, fn)   the plane z = const (roofs, floors, ground markings): local (x, y)
function isoLeft(ctx, y, fn) { ctx.save(); ctx.transform(0.866, 0.5, 0, 1, -y * 0.866, y * 0.5); fn(); ctx.restore(); }
function isoRight(ctx, x, fn) { ctx.save(); ctx.transform(0.866, -0.5, 0, 1, x * 0.866, x * 0.5); fn(); ctx.restore(); }
function isoTop(ctx, z, fn) { ctx.save(); ctx.transform(0.866, 0.5, -0.866, 0.5, 0, -z); fn(); ctx.restore(); }
function isoQuad(ctx, x0, y0, x1, y1, z, fill) { fillPoly(ctx, [ISO(x0, y0, z), ISO(x1, y0, z), ISO(x1, y1, z), ISO(x0, y1, z)], fill); }
// a polyline on a plane (lane markings, routes, property lines). o: { dash: [on, off], offset (animate with -t * speed), cap }
function isoPath(ctx, pts, z, col, lw = 2, o = {}) {
  ctx.save(); if (o.dash) { ctx.setLineDash(o.dash); ctx.lineDashOffset = o.offset || 0; }
  ctx.beginPath(); pts.forEach((p, i) => { const q = ISO(p[0], p[1], z); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
  ctx.lineWidth = lw; ctx.strokeStyle = col; ctx.lineCap = o.cap || 'round'; ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore();
}
function _illTones(col, o) { const tt = typeof col === 'string' ? tones(col) : Object.assign({}, col); for (const k of ['top', 'left', 'right']) if (o[k]) tt[k] = o[k]; return tt; }
// a box with its 3 visible faces shaded (col = base colour → auto tones, or {top, left, right}); o.edge: colour or true (auto), o.lw
function isoBox(ctx, x0, y0, x1, y1, z0, z1, col, o = {}) {
  const tt = _illTones(col, o);
  fillPoly(ctx, [ISO(x0, y1, z0), ISO(x1, y1, z0), ISO(x1, y1, z1), ISO(x0, y1, z1)], tt.left);
  fillPoly(ctx, [ISO(x1, y1, z0), ISO(x1, y0, z0), ISO(x1, y0, z1), ISO(x1, y1, z1)], tt.right);
  fillPoly(ctx, [ISO(x0, y0, z1), ISO(x1, y0, z1), ISO(x1, y1, z1), ISO(x0, y1, z1)], tt.top);
  if (o.edge) {
    const e = o.edge === true ? (tt.edge || 'rgba(0,0,0,0.35)') : o.edge, lw = o.lw || 1.5;
    edgePoly(ctx, [ISO(x0, y1, z0), ISO(x1, y1, z0), ISO(x1, y0, z0), ISO(x1, y0, z1), ISO(x0, y0, z1), ISO(x0, y1, z1)], e, lw);
    edgePoly(ctx, [ISO(x0, y1, z1), ISO(x1, y1, z1), ISO(x1, y0, z1)], e, lw * 0.7, true); edgePoly(ctx, [ISO(x1, y1, z0), ISO(x1, y1, z1)], e, lw * 0.7, true);
  }
}
// gable roof on the footprint, eaves at z, ridge `rise` higher. o.ridge 'x' (ridge runs along x, default) | 'y'; o.edge; o.gable (gable-end colour)
function isoPrism(ctx, x0, y0, x1, y1, z, rise, col, o = {}) {
  const tt = _illTones(col, o), zr = z + rise, gable = o.gable || shade(col, 0.82);
  if ((o.ridge || 'x') === 'x') {
    const ym = (y0 + y1) / 2;
    fillPoly(ctx, [ISO(x0, ym, zr), ISO(x1, ym, zr), ISO(x1, y0, z), ISO(x0, y0, z)], tt.top);            // back slope (visible when shallow)
    fillPoly(ctx, [ISO(x1, y1, z), ISO(x1, y0, z), ISO(x1, ym, zr)], gable);                                 // right gable end
    fillPoly(ctx, [ISO(x0, y1, z), ISO(x1, y1, z), ISO(x1, ym, zr), ISO(x0, ym, zr)], tt.left);              // front slope
    if (o.edge) { const e = o.edge === true ? tt.edge : o.edge; edgePoly(ctx, [ISO(x0, y1, z), ISO(x1, y1, z), ISO(x1, y0, z), ISO(x1, ym, zr), ISO(x0, ym, zr)], e, o.lw || 1.5); edgePoly(ctx, [ISO(x1, y1, z), ISO(x1, ym, zr)], e, (o.lw || 1.5) * 0.7, true); }
  } else {
    const xm = (x0 + x1) / 2;
    fillPoly(ctx, [ISO(xm, y0, zr), ISO(xm, y1, zr), ISO(x0, y1, z), ISO(x0, y0, z)], tt.top);              // left slope
    fillPoly(ctx, [ISO(x0, y1, z), ISO(x1, y1, z), ISO(xm, y1, zr)], gable);                                 // front gable end
    fillPoly(ctx, [ISO(x1, y1, z), ISO(x1, y0, z), ISO(xm, y0, zr), ISO(xm, y1, zr)], tt.right);             // right slope
    if (o.edge) { const e = o.edge === true ? tt.edge : o.edge; edgePoly(ctx, [ISO(x0, y1, z), ISO(x1, y1, z), ISO(x1, y0, z), ISO(xm, y0, zr), ISO(xm, y1, zr)], e, o.lw || 1.5); edgePoly(ctx, [ISO(x0, y1, z), ISO(xm, y1, zr)], e, (o.lw || 1.5) * 0.7, true); }
  }
}
// upright cylinder (tank, silo, cup, can, pillar) standing at (x, y): a circle of radius r projects to an ellipse 1.22 r × 0.71 r
function isoCylinder(ctx, x, y, r, z0, z1, col, o = {}) {
  const [cx, cb] = ISO(x, y, z0), ct = cb - (z1 - z0), rx = r * 1.2247, ry = r * 0.7071;
  ctx.save();
  ctx.beginPath(); ctx.moveTo(cx - rx, ct); ctx.lineTo(cx - rx, cb); ctx.ellipse(cx, cb, rx, ry, 0, Math.PI, 0, true); ctx.lineTo(cx + rx, ct); ctx.closePath();
  ctx.fillStyle = cylGrad(ctx, cx - rx, cx + rx, col); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx, ct, rx, ry, 0, 0, TAU); ctx.fillStyle = o.top || shade(col, 1.16); ctx.fill();
  if (o.edge) { const e = o.edge === true ? tones(col).edge : o.edge; ctx.lineWidth = o.lw || 1.4; ctx.strokeStyle = e; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - rx, ct); ctx.lineTo(cx - rx, cb); ctx.ellipse(cx, cb, rx, ry, 0, Math.PI, 0, true); ctx.lineTo(cx + rx, ct); ctx.stroke(); }
  ctx.restore();
}
// diorama ground tile: grass (or any) top, soil sides with a grass lip and pebbles, soft drop shadow
function isoSlab(ctx, x0, y0, x1, y1, depth = 14, o = {}) {
  const top = o.top || '#86C25E', side = o.side || '#8C633F', lip = o.lip === undefined ? shade(top, 0.72) : o.lip;
  if (o.shadow !== false) fillPoly(ctx, [ISO(x0, y1, -depth), ISO(x1, y1, -depth), ISO(x1, y0, -depth), ISO(x1 + 16, y0 - 4, -depth), ISO(x1 + 16, y1 + 16, -depth), ISO(x0 - 4, y1 + 16, -depth)].map(p => [p[0] + 3, p[1] + 4]), 'rgba(15,20,30,0.2)');
  fillPoly(ctx, [ISO(x0, y1, 0), ISO(x1, y1, 0), ISO(x1, y1, -depth), ISO(x0, y1, -depth)], side);
  fillPoly(ctx, [ISO(x1, y1, 0), ISO(x1, y0, 0), ISO(x1, y0, -depth), ISO(x1, y1, -depth)], shade(side, 0.78));
  const tex = (a, b, n, seed) => { if (o.specks === false) return; ctx.fillStyle = lip || 'transparent'; if (lip) ctx.fillRect(a, 0, b - a, Math.min(3.5, depth * 0.25));
    ctx.fillStyle = 'rgba(60,35,15,0.3)'; ctx.fillRect(a, depth * 0.62, b - a, 1.4);
    for (let i = 0; i < n; i++) circle(ctx, a + 8 + (i + hash(i + seed) * 0.5) * ((b - a - 16) / n), depth * 0.3 + hash(i * 3 + seed) * depth * 0.55, 1.3, 'rgba(235,205,165,0.5)'); };
  isoLeft(ctx, y1, () => tex(x0, x1, Math.round((x1 - x0) / 15), 1));
  isoRight(ctx, x1, () => tex(-y1, -y0, Math.round((y1 - y0) / 15), 7));
  isoQuad(ctx, x0, y0, x1, y1, 0, top);
}

// ═════════════ 5 · windows, glass, awnings (draw them in face-local coords via isoLeft / isoRight, or flat) ═════════════
// a lit shop window: warm interior gradient, counter band, people silhouettes, reflection, optional mullions (every `mull` units)
function litWindow(ctx, x, y, w, h, o = {}) {
  const seed = o.seed || 1, lit = o.lit == null ? 1 : clamp(o.lit);
  ctx.fillStyle = lit > 0.5 ? vGrad(ctx, y, y + h, ['#FFF2C8', '#FFD27A', '#F2A94A']) : vGrad(ctx, y, y + h, ['#B8CCDA', '#7E98AD', '#5C7488']);
  ctx.fillRect(x, y, w, h);
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  if (lit > 0.5) {
    ctx.fillStyle = 'rgba(150,80,20,0.3)'; ctx.fillRect(x, y + h * 0.66, w, h * 0.34);
    if (o.people !== false) for (let i = 0; i < Math.round(w / 15); i++) {
      if (hash(seed * 7 + i) < 0.35) continue;
      const px = x + 6 + (i + hash(seed + i) * 0.6) * 15, ph = h * (0.3 + 0.18 * hash(seed * 3 + i)), c = 'rgba(110,55,20,0.42)';
      circle(ctx, px, y + h - ph - 2.4, Math.min(2.6, h * 0.1), c); fillRR(ctx, px - 3.2, y + h - ph, 6.4, ph, 2.5, c);
    }
  }
  ctx.restore();
  glassStreak(ctx, x, y, w, h, 0.3);
  const fr = o.frame || '#3A3430';
  if (o.mull) { ctx.fillStyle = fr; for (let mx = x; mx <= x + w + 0.1; mx += o.mull) ctx.fillRect(mx - 0.9, y, 1.8, h); ctx.fillRect(x, y - 1, w, 2); ctx.fillRect(x, y + h - 1, w, 2); }
}
// a facade of windows (office tower, apartment block): some lit warm, some dark glass with sky reflection; o.t makes a few switch
function windowGrid(ctx, x, y, w, h, cols, rows, o = {}) {
  const gap = o.gap == null ? 0.28 : o.gap, cw = w / cols, chh = h / rows, ww = cw * (1 - gap), wh = chh * (1 - gap), seed = o.seed || 3, on = o.on == null ? 0.45 : o.on;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const k = j * cols + i, flick = o.t != null ? Math.floor(o.t * 0.7 + hash(k * 1.3 + seed) * 9) : 0;
    const lit = hash(k * 2.1 + seed + (hash(k + seed) < 0.12 ? flick * 0.37 : 0)) < on;
    const wx = x + i * cw + (cw - ww) / 2, wy = y + j * chh + (chh - wh) / 2;
    ctx.fillStyle = lit ? vGrad(ctx, wy, wy + wh, ['#FFF0BE', '#FFC864']) : vGrad(ctx, wy, wy + wh, ['#A9C4D8', '#56708A']);
    ctx.fillRect(wx, wy, ww, wh);
    if (!lit) { ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(wx, wy, ww * 0.35, wh); }
    if (o.frame) { ctx.strokeStyle = o.frame; ctx.lineWidth = 0.9; ctx.strokeRect(wx, wy, ww, wh); }
  }
}
// striped awning over a shop window (flat coords; put it on a face with isoLeft). cols [a, b]; o.n stripes, o.scallop (default true)
function awning(ctx, x, y, w, h, cols = ['#D8402F', '#FFFFFF'], o = {}) {
  const n = o.n || 8, sw = w / n;
  for (let i = 0; i < n; i++) { ctx.fillStyle = cols[i % 2]; ctx.fillRect(x + i * sw, y, sw + 0.4, h); if (o.scallop !== false) { ctx.beginPath(); ctx.arc(x + i * sw + sw / 2, y + h, sw / 2, 0, Math.PI); ctx.fill(); } }
  ctx.fillStyle = 'rgba(0,0,0,0.14)'; ctx.fillRect(x, y + h * 0.75, w, h * 0.25);
  ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(x, y, w, Math.max(1, h * 0.12));
}

// ═════════════ 6 · life: trees, cars, tiny people, pole signs, steam ═════════════
function isoTree(ctx, x, y, s = 1, o = {}) {
  const [gx, gy] = ISO(x, y, 0), col = o.col || '#3C8536', sw = o.t != null ? Math.sin(o.t * 1.4 + x * 0.05 + y * 0.03) * 1.2 * s : 0;
  ctx.save(); ctx.fillStyle = 'rgba(20,40,10,0.24)'; ctx.beginPath(); ctx.ellipse(gx + 9 * s, gy + 1, 15 * s, 6 * s, 0, 0, TAU); ctx.fill(); ctx.restore();
  ctx.fillStyle = '#6B4A2E'; ctx.fillRect(gx - 1.8 * s, gy - 13 * s, 3.6 * s, 13 * s);
  circle(ctx, gx + sw * 0.6, gy - 23 * s, 13.5 * s, col); circle(ctx, gx - 2.5 * s + sw, gy - 26 * s, 10.5 * s, shade(col, 1.25)); circle(ctx, gx - 5 * s + sw, gy - 29.5 * s, 5.5 * s, shade(col, 1.55));
}
// a car on the ground plane, centred at (x, y) iso units, driving along dir 'x' or 'y'. o: { brake 0..1, s scale }
function isoCar(ctx, x, y, dir, col, o = {}) {
  const s = o.s || 1, Lh = 17 * s, Wh = 8.5 * s, X0 = dir === 'x' ? x - Lh : x - Wh, X1 = dir === 'x' ? x + Lh : x + Wh, Y0 = dir === 'x' ? y - Wh : y - Lh, Y1 = dir === 'x' ? y + Wh : y + Lh;
  fillPoly(ctx, [ISO(X0 - 1, Y1 + 2), ISO(X1 + 4, Y1 + 2), ISO(X1 + 4, Y0 - 2), ISO(X0 - 1, Y0 - 2)], 'rgba(10,10,20,0.3)');
  isoBox(ctx, X0, Y0, X1, Y1, 2.5 * s, 9.5 * s, { top: shade(col, 1.12), left: col, right: shade(col, 0.74) }, { edge: 'rgba(0,0,0,0.35)', lw: 1.2 });
  const wh = (wx, wy, rot) => { const [a, b] = ISO(wx, wy, 2.6 * s); ctx.fillStyle = '#18181C'; ctx.beginPath(); ctx.ellipse(a, b, 3.3 * s, 3.8 * s, rot, 0, TAU); ctx.fill(); };
  if (dir === 'x') { wh(x - 10 * s, Y1, 0.5); wh(x + 10 * s, Y1, 0.5); } else { wh(X1, y - 10 * s, -0.5); wh(X1, y + 10 * s, -0.5); }
  const c = dir === 'x' ? [x - 9 * s, Y0 + 1.2 * s, x + 6 * s, Y1 - 1.2 * s] : [X0 + 1.2 * s, y - 6 * s, X1 - 1.2 * s, y + 8 * s];
  isoBox(ctx, c[0], c[1], c[2], c[3], 9.5 * s, 16 * s, { top: shade(col, 1.05), left: '#2C3B4F', right: '#1F2B3B' }, { edge: 'rgba(0,0,0,0.3)', lw: 1 });
  const gl = dir === 'x' ? ISO(c[0] + 3 * s, c[3], 13 * s) : ISO(c[2], c[1] + 3 * s, 13 * s);
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(gl[0] - 1, gl[1] - 2 * s, 2.5 * s, 4 * s);
  const br = o.brake || 0;
  if (br > 0 && dir === 'y') { ctx.save(); ctx.globalAlpha *= br; for (const bx of [X0 + 2.5 * s, X1 - 2.5 * s]) { const [a, b] = ISO(bx, Y1, 6.5 * s); circle(ctx, a, b, 5.5 * s, 'rgba(255,60,40,0.3)'); circle(ctx, a, b, 2.2 * s, '#FF3A2A'); } ctx.restore(); }
}
// a tiny upright person (screen-aligned, ~36 px tall at s = 1), feet at (x, y). o: { ph (walk phase, e.g. t * 13), walking (default true),
// flip, shirt, pants, skin, hair, bag (colour of a shopping bag in the right hand, or null) }
function tinyPerson(ctx, x, y, s = 1, o = {}) {
  const ph = o.ph || 0, wk = o.walking === false ? 0 : 1, sw = Math.sin(ph) * wk, bob = Math.abs(Math.cos(ph)) * 1.2 * wk;
  const skin = o.skin || '#E9C4A3', ink = '#1B1C22';
  ctx.save(); ctx.translate(x, y); ctx.scale(o.flip ? -s : s, s);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(0, 0, 9, 3.2, 0, 0, TAU); ctx.fill();
  line(ctx, -2.4, -11, -2.4 + sw * 3.5, -0.5, o.pants || '#2A3140', 3.6); line(ctx, 2.4, -11, 2.4 - sw * 3.5, -0.5, o.pants || '#2A3140', 3.6);
  ctx.translate(0, -bob);
  line(ctx, -5.5, -21, -6.5 - sw * 3, -12, skin, 2.8);
  fillRR(ctx, -6.5, -25, 13, 15, 5, o.shirt || '#2E6DB4'); strokeRR(ctx, -6.5, -25, 13, 15, 5, ink, 1.3);
  line(ctx, 5.5, -21, 7 + sw * 2, -15, skin, 2.8);
  if (o.bag) { line(ctx, 7, -16, 7, -21, shade(o.bag, 0.6), 1.4); fillRR(ctx, 4.5, -16, 9, 9, 1.5, o.bag); strokeRR(ctx, 4.5, -16, 9, 9, 1.5, ink, 1.1); }
  circle(ctx, 0, -30, 5.2, skin, ink, 1.3);
  ctx.beginPath(); ctx.arc(0, -31, 5.4, Math.PI * 1.02, Math.PI * 1.98); ctx.closePath(); ctx.fillStyle = o.hair || '#3A2E26'; ctx.fill();
  ctx.restore();
}
function isoPerson(ctx, x, y, s = 1, o = {}) { const [a, b] = ISO(x, y, 0); tinyPerson(ctx, a, b, s, o); }
// a pole sign (screen-aligned billboard on a metal pole), base at screen (bx, by). The pole shoots up with p, the panel pops open.
// o: { p 0..1.2, w 60, h 54, col (panel colour), draw(ctx, w, h) panel content centred at 0, 0 }
function poleSign(ctx, bx, by, hgt, o = {}) {
  const p = o.p == null ? 1 : o.p; if (p <= 0.02) return;
  const k = clamp(p, 0, 1.2), top = by - hgt * k, ps = clamp(k * 1.6, 0.05, 1), pw = (o.w || 60) * ps, ph = (o.h || 54) * ps, col = o.col || '#D8402F';
  ctx.save(); ctx.fillStyle = 'rgba(20,20,30,0.25)'; ctx.beginPath(); ctx.ellipse(bx + 6, by + 1, 10, 4, 0, 0, TAU); ctx.fill(); ctx.restore();
  ctx.fillStyle = hGrad(ctx, bx - 4, bx + 4, [[0, '#77746F'], [0.35, '#E2DED7'], [1, '#5E5B57']]); ctx.fillRect(bx - 3.6, top, 7.2, by - top);
  const py = top - ph / 2 + 8;
  fillRR(ctx, bx - pw / 2 + 5, py - ph / 2 - 3, pw, ph, 9 * ps, shade(col, 0.5));                           // panel thickness
  fillRR(ctx, bx - pw / 2, py - ph / 2, pw, ph, 9 * ps, vGrad(ctx, py - ph / 2, py + ph / 2, [shade(col, 1.15), shade(col, 0.88)]));
  strokeRR(ctx, bx - pw / 2 + 2.5, py - ph / 2 + 2.5, pw - 5, ph - 5, 7 * ps, 'rgba(255,255,255,0.22)', 1.4);
  strokeRR(ctx, bx - pw / 2, py - ph / 2, pw, ph, 9 * ps, shade(col, 0.4), 1.4);
  if (o.draw) { ctx.save(); ctx.translate(bx, py); o.draw(ctx, pw, ph); ctx.restore(); }
}
// rising steam / heat wisps (hot food, coffee, a busy kitchen vent), base at (x, y)
function steam(ctx, x, y, t, o = {}) {
  const n = o.n || 3, H = o.h || 80, a = o.a == null ? 0.55 : o.a, col = o.col || '255,255,255';
  ctx.save(); ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const ph = ((t * 0.55 + i / n) % 1), xx = x + (i - (n - 1) / 2) * (o.gap || 16);
    ctx.strokeStyle = `rgba(${col},${a * Math.sin(ph * Math.PI)})`; ctx.lineWidth = (o.lw || 5) * (1 - ph * 0.4);
    ctx.beginPath();
    for (let k = 0; k <= 10; k++) { const q = k / 10, yy = y - ph * H * 0.5 - q * H * 0.5, dx = Math.sin(q * 5 + t * 3 + i * 2) * 6 * q; k ? ctx.lineTo(xx + dx, yy) : ctx.moveTo(xx + dx, yy); }
    ctx.stroke();
  }
  ctx.restore();
}

// ═════════════ 7 · stickers: placement + die-cut (white border + soft shadow) ═════════════
// draw fn() in its NATURAL coords (bounds box = [x0, y0, x1, y1]) so the box's bottom-centre lands at (x, y), scaled by s
function placeArt(ctx, box, x, y, s, fn) { ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.translate(-(box[0] + box[2]) / 2, -box[3]); fn(ctx); ctx.restore(); }
// die-cut sticker: renders fn(c) (natural coords, bounds box) off-screen at device resolution, dilates a white border, drops a shadow.
// o: { pad 9 (border width, natural units), border '#FFFFFF', shadow [dx, dy, alpha] = [5, 11, 0.5], shadowCol,
//      T (tone ctx: the shadow prints as HALFTONE on paper instead of rgba on K; transform T exactly like K, e.g. X([T, K], ...)),
//      cache 'key' (art doesn't change with t: rendered once per key + scale and reused, much faster) }
var _ILL_DC = null, _ILL_CACHE = new Map();
function _illCanvas() { const c = document.createElement('canvas'); c.width = c.height = 2; return c; }
function dieCut(ctx, box, fn, o = {}) {
  const m = ctx.getTransform(), sc = clamp(Math.hypot(m.a, m.b), 0.05, 4);
  const pad = o.pad == null ? 9 : o.pad, M = pad + 3, X0 = box[0] - M, Y0 = box[1] - M, BW = box[2] - box[0] + 2 * M, BH = box[3] - box[1] + 2 * M;
  const cw = Math.max(2, Math.ceil(BW * sc)), ch = Math.max(2, Math.ceil(BH * sc));
  if (cw * ch > 9e6) { fn(ctx); return; }
  let set = null;
  const key = o.cache ? o.cache + '|' + cw + 'x' + ch + '|' + pad : null;
  if (key && _ILL_CACHE.has(key)) set = _ILL_CACHE.get(key);
  else {
    if (key) { set = [_illCanvas(), _illCanvas(), _illCanvas()]; if (_ILL_CACHE.size > 24) _ILL_CACHE.delete(_ILL_CACHE.keys().next().value); _ILL_CACHE.set(key, set); }
    else set = _ILL_DC || (_ILL_DC = [_illCanvas(), _illCanvas(), _illCanvas()]);
    const [A, B, S] = set; for (const c of set) { c.width = cw; c.height = ch; }
    const a = A.getContext('2d'), b = B.getContext('2d'), s = S.getContext('2d');
    a.setTransform(sc, 0, 0, sc, -X0 * sc, -Y0 * sc); fn(a);
    const r = pad * sc;
    for (let i = 0; i < 24; i++) { const ang = i / 24 * TAU; b.drawImage(A, Math.cos(ang) * r, Math.sin(ang) * r); if (i % 2 === 0) b.drawImage(A, Math.cos(ang) * r * 0.55, Math.sin(ang) * r * 0.55); }
    b.drawImage(A, 0, 0);
    b.globalCompositeOperation = 'source-in'; b.fillStyle = o.border || '#FFFFFF'; b.fillRect(0, 0, cw, ch);
    s.drawImage(B, 0, 0); s.globalCompositeOperation = 'source-in'; s.fillStyle = o.shadowCol || '#000000'; s.fillRect(0, 0, cw, ch);
  }
  const [A, B, S] = set, sh = o.shadow || [5, 11, 0.5], sctx = o.T || ctx;
  if (sh[2] > 0) { sctx.save(); sctx.globalAlpha *= sh[2] * (o.T ? 1.3 : 1); sctx.drawImage(S, X0 + sh[0], Y0 + sh[1], BW, BH); sctx.restore(); }
  ctx.drawImage(B, X0, Y0, BW, BH); ctx.drawImage(A, X0, Y0, BW, BH);
}
// placeArt + dieCut in one call; the border stays `pad` px wide whatever s is. With o.T, transform T like ctx (X([T, K], ...)).
function sticker(ctx, box, x, y, s, fn, o = {}) {
  const pad = (o.pad == null ? 9 : o.pad) / Math.max(0.05, s), T = o.T;
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.translate(-(box[0] + box[2]) / 2, -box[3]);
  if (T) { T.save(); T.translate(x, y); T.scale(s, s); T.translate(-(box[0] + box[2]) / 2, -box[3]); }
  dieCut(ctx, box, fn, Object.assign({}, o, { pad }));
  if (T) T.restore();
  ctx.restore();
}

// ═════════════ 8 · the PLAYING REEL: a phone screen that looks like a real video playing (never a static card) ═════════════
// shots = [{ id, t0, cut: 'cut' | 'kick' | 'zoom' | 'whip', dark }] in loop seconds; loop = loop length. The loop is clocked by the
// ABSOLUTE reel time t (+ off), so the little edit keeps playing continuously across your scene cuts.
// → { lt (loop time), sh (current shot, with .i and .t1), d (time into the shot), p (progress 0..1 of the whole loop) }
function shotClock(t, shots, loop, off = 0) {
  if (!shots._ready) { shots.forEach((s, i) => { s.i = i; s.t1 = i + 1 < shots.length ? shots[i + 1].t0 : loop; }); shots._ready = true; }
  const lt = (((t + off) % loop) + loop) % loop;
  let sh = shots[0]; for (const s of shots) if (lt >= s.t0) sh = s;
  return { lt, sh, d: lt - sh.t0, p: lt / loop };
}
// the edit's camera: an entry move per cut type + a zoom kick on every accent word (hot = loop times). → { z, dx, whip }
function shotCam(lt, shots, w, o = {}) {
  let sh = shots[0]; for (const s of shots) if (lt >= s.t0) sh = s;
  const d = lt - sh.t0; let z = 1, dx = 0, whip = 0;
  if (sh.cut === 'zoom') z += 0.32 * (1 - E.outCubic(clamp(d / 0.28)));
  if (sh.cut === 'kick') z += 0.14 * (1 - E.outCubic(clamp(d / 0.24)));
  if (sh.cut === 'cut') z += 0.08 * (1 - clamp(d / 0.18));
  if (sh.cut === 'whip' && d < 0.16) { const k = 1 - E.outCubic(d / 0.16); dx += k * w * 0.95; whip = k; }
  const nx = shots[(sh.i + 1) % shots.length], left = sh.t1 - lt;
  if (nx && nx.cut === 'whip' && left < 0.09) { const k = E.inCubic(1 - left / 0.09); dx -= k * w * 0.95; whip = Math.max(whip, k); }
  for (const ht of (o.hot || [])) { const q = lt - ht; if (q > 0 && q < 0.3) z += 0.07 * (1 - q / 0.3) ** 2; }
  return { z, dx, whip };
}
// whip-pan motion streaks over the screen (k = whip strength from shotCam)
function whipStreaks(ctx, x, y, w, h, k, seed = 0, col = '#111111') {
  if (k <= 0.02) return;
  ctx.save(); ctx.globalAlpha *= 0.42 * k;
  for (let i = 0; i < 10; i++) {
    const yy = y + h * (0.27 + 0.48 * hash(i * 1.7 + seed)), ln = w * (0.35 + 0.55 * hash(i * 2.3 + seed)), xx = x + (w - ln) * hash(i * 3.1 + seed);
    fillRR(ctx, xx, yy, ln, (3 + 6 * hash(i + seed)) * w / 400, 3 * w / 400, col);
  }
  ctx.restore();
}
// kinetic caption chunk inside the mini reel: words [{s, hot}] pop in one by one (0.13 s apart), Anton, white keyline, hot word accent.
// o: { scale, rot (deg, default -2), dark (white words with an ink keyline, for dark shots) }
// u = screen width / 400; d = time since the chunk started
function reelCaption(ctx, cx, cy, u, maxW, words, d, o = {}) {
  const f = { font: F.anton, weight: 400, size: 54 * u };
  const ws = words.map(wd => measure(ctx, wd.s, f)), sp = 13 * u, tot = ws.reduce((a, b) => a + b, 0) + sp * (ws.length - 1);
  const k = Math.min(1, maxW / tot) * (o.scale == null ? 1 : o.scale);
  if (k <= 0.01) return;
  ctx.save(); ctx.translate(cx, cy); ctx.rotate((o.rot == null ? -2 : o.rot) * D2R); ctx.scale(k, k);
  let xx = -tot / 2;
  words.forEach((wd, i) => {
    const dd = d - i * 0.13;
    if (dd > 0) { const s = clamp(pop(dd, 3.2, 0.45), 0, 1.3); X([ctx], xx + ws[i] / 2, 0, s, (1 - clamp(dd / 0.12)) * 6, () => text(ctx, wd.s, 0, 19 * u, Object.assign({ color: wd.hot ? C.red : (o.dark ? '#FFFFFF' : C.ink), slw: 11 * u, stroke: o.dark ? '#111111' : '#FFFFFF' }, f))); }
    xx += ws[i] + sp;
  });
  ctx.restore();
}
// speech loudness 0..1 at loop time lt, from the spoken word onsets (loop seconds)
function voiceEnv(lt, onsets) {
  let e = 0;
  for (let i = 0; i < onsets.length; i++) { const d = lt - onsets[i] + 0.03; if (d > 0 && d < 0.3) e = Math.max(e, Math.sin(d / 0.3 * Math.PI) * (0.72 + 0.28 * hash(i * 3.7))); }
  return e;
}
// scrolling voice waveform around a fixed playhead (played = accent, ahead = grey); bars peak on the onsets. o: { dark, p (reveal 0..1) }
function voiceWave(ctx, t, lt, x0, x1, wy, u, onsets, o = {}) {
  const SPAN = 2.4, N = 30, dt = SPAN / N, ww = x1 - x0, xc = x0 + ww * 0.5, j0 = Math.floor((lt - SPAN / 2) / dt), vp = o.p == null ? 1 : o.p, dark = o.dark;
  for (let j = j0; j <= j0 + N + 1; j++) {
    const tj = j * dt, px = xc + (tj - lt) / SPAN * ww;
    if (px < x0 || px > x1 || (px - x0) / ww > vp) continue;
    const e = voiceEnv(tj, onsets), hh = (5 + 36 * e * (0.55 + 0.45 * hash(j * 1.31)) + 2.5 * (1 + Math.sin(t * 9 + j))) * u;
    ctx.save(); ctx.globalAlpha *= clamp(Math.min((px - x0) / (ww * 0.14), (x1 - px) / (ww * 0.14)));
    fillRR(ctx, px - 2.7 * u, wy - hh / 2, 5.4 * u, hh, 2.7 * u, tj <= lt ? (dark ? '#FFFFFF' : C.red) : (dark ? 'rgba(255,255,255,0.4)' : 'rgba(17,17,17,0.2)'));
    ctx.restore();
  }
  if (vp > 0.5) { const pc = dark ? '#FFFFFF' : C.ink; line(ctx, xc, wy - 25 * u, xc, wy + 25 * u, pc, 3 * u); circle(ctx, xc, wy - 25 * u, 5 * u, pc); }
}
function _illHeart(ctx, x, y, r) { ctx.beginPath(); ctx.moveTo(x, y + r * 0.95); ctx.bezierCurveTo(x - r * 1.55, y - r * 0.05, x - r * 0.85, y - r * 1.25, x, y - r * 0.45); ctx.bezierCurveTo(x + r * 0.85, y - r * 1.25, x + r * 1.55, y - r * 0.05, x, y + r * 0.95); ctx.closePath(); }
// a short-video app overlay (generic, no real UI copied): pulsing heart, comment, share, avatar + handle + Follow, scrolling audio
// line, bottom progress bar. o: { handle '@yourhandle', a (fade 0..1), progress 0..1, counts: ['1.2K', '86'] (only REAL numbers; default none) }
function reelOverlay(ctx, t, x, y, w, h, u, o = {}) {
  const a = o.a == null ? 1 : o.a; if (a <= 0) return;
  ctx.save(); ctx.globalAlpha *= a;
  ctx.fillStyle = vGrad(ctx, y + h * 0.66, y + h, ['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']); ctx.fillRect(x, y + h * 0.66, w, h * 0.34);
  const rx = x + w - 31 * u, ry = y + 0.56 * h, WT = '#FFFFFF', NF = { font: ILL_SANS, weight: 700, size: 19 * u, color: WT }, cn = o.counts || [];
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 7 * u;
  const lk = (t + 3) / 0.55, bump = 1 + 0.28 * Math.max(0, 1 - (lk - Math.floor(lk)) / 0.3);
  X([ctx], rx, ry, bump, 0, () => { _illHeart(ctx, 0, 0, 16 * u); ctx.fillStyle = '#FF3040'; ctx.fill(); });
  if (cn[0]) text(ctx, cn[0], rx, ry + 38 * u, NF);
  const cy2 = ry + 66 * u;
  ctx.strokeStyle = WT; ctx.lineWidth = 3.4 * u; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.arc(rx, cy2, 14 * u, 0.55 * Math.PI, 2.35 * Math.PI); ctx.lineTo(rx - 15 * u, cy2 + 15 * u); ctx.closePath(); ctx.stroke();
  if (cn[1]) text(ctx, cn[1], rx, cy2 + 37 * u, NF);
  const cy3 = ry + 128 * u;
  ctx.beginPath(); ctx.moveTo(rx - 15 * u, cy3 - 11 * u); ctx.lineTo(rx + 15 * u, cy3 - 13 * u); ctx.lineTo(rx + 2 * u, cy3 + 15 * u); ctx.lineTo(rx - 3 * u, cy3 - 2 * u); ctx.closePath(); ctx.moveTo(rx - 3 * u, cy3 - 2 * u); ctx.lineTo(rx + 15 * u, cy3 - 13 * u); ctx.stroke();
  ctx.restore();
  const by = y + 0.915 * h, handle = o.handle || '@yourhandle';
  circle(ctx, x + 30 * u, by, 16 * u, '#D9D5CC', WT, 2 * u); text(ctx, handle.replace('@', '').slice(0, 1).toUpperCase(), x + 30 * u, by + 7 * u, { font: ILL_SANS, weight: 800, size: 18 * u, color: '#55524C' });
  const HF = { font: ILL_SANS, weight: 700, size: 21 * u, color: WT, align: 'left' }, hw = measure(ctx, handle, HF);
  text(ctx, handle, x + 54 * u, by + 7 * u, HF);
  strokeRR(ctx, x + 64 * u + hw, by - 15 * u, 74 * u, 30 * u, 8 * u, WT, 2 * u);
  text(ctx, 'Follow', x + 101 * u + hw, by + 6 * u, { font: ILL_SANS, weight: 700, size: 17 * u, color: WT });
  const ay = y + 0.955 * h;
  text(ctx, '♫', x + 22 * u, ay + 6 * u, { font: ILL_SANS, weight: 700, size: 17 * u, color: WT });
  ctx.save(); ctx.beginPath(); ctx.rect(x + 40 * u, ay - 16 * u, w * 0.56, 26 * u); ctx.clip();
  const AS = handle + ' · Original audio   ·   ', AF = { font: ILL_SANS, weight: 600, size: 17 * u, color: WT, align: 'left' }, aw = measure(ctx, AS, AF), off = (t * 30 * u) % aw;
  for (let k = 0; k < 3; k++) text(ctx, AS, x + 40 * u - off + k * aw, ay + 6 * u, AF);
  ctx.restore();
  if (o.progress != null) { fillRR(ctx, x, y + h - 5 * u, w, 5 * u, 0, 'rgba(255,255,255,0.3)'); fillRR(ctx, x, y + h - 5 * u, w * clamp(o.progress), 5 * u, 0, WT); }
  ctx.restore();
}
// the reel's own presenter, tiny, talking inside the mini reel (lip sync from the real voice, pose per shot). pose = state extras
// ({armL: 'point', pointAng: -40, smile: 0.6, ...}). Skipped when reel.json "presenter": false.
var _ILL_NT = null;
function miniGuy(ctx, t, x, y, s, pose = {}) {
  if (typeof guyState !== 'function' || !window.PRESENTER || (typeof REEL !== 'undefined' && REEL.presenter === false)) return;
  if (!_ILL_NT) { const c = document.createElement('canvas'); c.width = c.height = 2; _ILL_NT = c.getContext('2d'); }   // swallows the bust's tone shadow
  const st = guyState(t, Object.assign({ t, x, y, s, armL: 'point', armLp: 1, armR: 'down', armRp: 1, lookX: -0.7, lookY: -0.45, headTurn: -0.3 }, pose));
  PRESENTER.draw(_ILL_NT, ctx, st);
}
