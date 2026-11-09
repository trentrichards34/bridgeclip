// ═════════════ 00 · HOOK  [0 – 3.54] · video B "plug it in" · classic look ═════════════
// NOTE: reference code from a real reel. Word indices (wi(n)) refer to that reel's script; re-cue on your own words.json.
// Through-object left in: powerStrip() (kit) and the ccWindow terminal; they are the scene's hand-off state.
// assets not included: IMG.db_av, IMG.deploy_av, IMG.tools_av, IMG.crew_char (optional avatars; lookups no-op when missing).
// Hook beat: the dead "Claude Code" power strip slams onto the stage (4 empty sockets,
//   meter 0/4). Its master LED sputters and dies on "vibe coding"; the CLAUDE CODE label is underlined on "Claude Code".
// "until you've installed these four plugins.": the strip shakes "no" and the 0/4 meter is boxed in red, the presenter reaches up
//   for it, and on "four plugins" the four sockets pulse one by one (dashed ghost plugs drop over them). Then it docks.
// Ends exactly in the hand-off state: powerStrip at STRIP_DOCK (0/4, kit call), the presenter at PRESENTER_DOCK.
// This file also defines the ba* helpers shared with plugins_db.js and plugins_deploy.js (it loads first).

// ─────────────── shared ba helpers (strip space, cables, plugs, power FX, powered panel) ───────────────
const BA_SOCK_Y = STRIP_H / 2 + 6, BA_SEAT_Y = BA_SOCK_Y - 8, BA_PS = 0.62;     // socket centre y, seated plug origin y, kit plug scale
const BA_DOCK = { x: STRIP_DOCK.x, y: STRIP_DOCK.y, s: STRIP_DOCK.s, r: 0, sx: 1, sy: 1 };
// strip geometry from its bottom-centre (cx, by) and scale; r = rotation (deg), sx/sy = squash about the bottom-centre
const baG = (cx, by, s, extra) => Object.assign({ x: cx - s * STRIP_W / 2, y: by - s * STRIP_H, s, r: 0, sx: 1, sy: 1 }, extra || {});
const baLerpG = (a, b, k) => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), s: lerp(a.s, b.s, k), r: lerp(a.r || 0, b.r || 0, k),
  sx: lerp(a.sx ?? 1, b.sx ?? 1, k), sy: lerp(a.sy ?? 1, b.sy ?? 1, k) });
// run fn in strip-local space (same space powerStrip draws in). At BA_DOCK this is exactly translate(60, 1560).
function baIn(cs, g, fn) {
  for (const c of cs) {
    c.save(); c.translate(g.x + g.s * STRIP_W / 2, g.y + g.s * STRIP_H); c.rotate((g.r || 0) * D2R);
    c.scale(g.s * (g.sx ?? 1), g.s * (g.sy ?? 1)); c.translate(-STRIP_W / 2, -STRIP_H);
  }
  fn();
  for (const c of cs) c.restore();
}
function baPt(g, lx, ly) {                                    // strip-local → scene
  const ax = (lx - STRIP_W / 2) * g.s * (g.sx ?? 1), ay = (ly - STRIP_H) * g.s * (g.sy ?? 1), r = (g.r || 0) * D2R;
  return [g.x + g.s * STRIP_W / 2 + ax * Math.cos(r) - ay * Math.sin(r), g.y + g.s * STRIP_H + ax * Math.sin(r) + ay * Math.cos(r)];
}
const baDockStrip = (T, K, t) => powerStrip(T, K, STRIP_DOCK.x, STRIP_DOCK.y, STRIP_DOCK.s, { t });   // the exact cut state

// cables: the kit's bezier shape (plugCable), as 4 control points so they can be blended / sampled
function baCab(x0, y0, x1, y1, a0 = 0, c0 = 160, c1 = 220) {
  return [[x0, y0], [x0 + Math.sin(a0 * D2R) * c0, y0 - Math.cos(a0 * D2R) * c0], [x1, y1 + c1], [x1, y1]];
}
const baLerpP = (A, B, k) => A.map((p, i) => [lerp(p[0], B[i][0], k), lerp(p[1], B[i][1], k)]);
const baBez = (P, u) => { const v = 1 - u, a = v * v * v, b = 3 * v * v * u, c = 3 * v * u * u, d = u * u * u; return [a * P[0][0] + b * P[1][0] + c * P[2][0] + d * P[3][0], a * P[0][1] + b * P[1][1] + c * P[2][1] + d * P[3][1]]; };
function baCabDraw(K, P, lw = 10, col = C.ink) {
  K.save(); K.lineCap = 'round'; K.lineWidth = lw;
  // ink cables dissolve between canvas y 830 → 620 (same as the kit's plugCable), so they never cut through the headline
  const up = P[3][1] < P[0][1], m = K.getTransform(), ly = Y => (Y - m.f - m.b * P[3][0]) / m.d;
  if (col === C.ink) { const g = K.createLinearGradient(0, ly(830), 0, ly(620)); g.addColorStop(0, col); g.addColorStop(1, 'rgba(17,17,17,0)'); K.strokeStyle = g; } else K.strokeStyle = col;
  K.beginPath(); K.moveTo(P[0][0], P[0][1]); K.bezierCurveTo(P[1][0], P[1][1], P[2][0], P[2][1], P[3][0], P[3][1]);
  if (col === C.ink && up) K.lineTo(P[3][0], Math.min(P[3][1], ly(600)));
  K.stroke(); K.restore();
}
// the kit's seated cable of plug i for a strip at g (scene coords); line width is 10 * g.s
function baKitCab(g, i) {
  const sx = socketX(i), x1 = sx + 60 + i * 30;
  return [[sx, BA_SEAT_Y - 110], [sx, BA_SEAT_Y - 270], [x1, -680], [x1, -900]].map(([x, y]) => baPt(g, x, y));
}
// halftone glow on T (black → grey dots, '255,0,0' → red dots)
function baGlow(T, x, y, rx, ry, a, rgb = '0,0,0') {
  if (a <= 0.004) return;
  T.save(); T.translate(x, y); T.scale(1, ry / rx);
  const g = T.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(0.5, `rgba(${rgb},${a * 0.42})`); g.addColorStop(1, `rgba(${rgb},0)`);
  T.fillStyle = g; T.fillRect(-rx, -rx, rx * 2, rx * 2); T.restore();
}
// power flowing along a cable P (plug → device): a bright lead pulse, then a steady stream of red "photons" inside the cable
function baFlow(T, K, P, t, t0, o = {}) {
  if (t < t0) return;
  const N = 36, pts = [], L = [0];
  for (let i = 0; i <= N; i++) { pts.push(baBez(P, i / N)); if (i) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); }
  const tot = L[N];
  const at = d => { d = clamp(d, 0, tot); let i = 1; while (i < N && L[i] < d) i++; const u = (d - L[i - 1]) / Math.max(1e-6, L[i] - L[i - 1]); return [lerp(pts[i - 1][0], pts[i][0], u), lerp(pts[i - 1][1], pts[i][1], u)]; };
  const { lead = 0.3, r = 3.4, gap = 44, speed = 360, a = 1 } = o;
  const lp = (t - t0) / lead, reach = tot * E.inOutCubic(clamp(lp));
  K.save(); K.globalAlpha *= a;
  const off = ((t - t0) * speed) % gap;
  for (let d = off; d < reach - 6; d += gap) { const q = at(d); circle(K, q[0], q[1], r, C.red); }
  if (lp < 1.12) {
    const q = at(reach), k = 1 - clamp((lp - 0.9) / 0.22);
    baGlow(T, q[0], q[1], 70 * (o.s || 1), 70 * (o.s || 1), 0.75 * k * a, '255,0,0');
    circle(K, q[0], q[1], r * 3.1 * k, C.red); circle(K, q[0], q[1], r * 1.3 * k, '#FFE1DA');
  }
  K.restore();
}
// a kit plug (plugHead) with extra transform (rot, squash) + the plugin's avatar on its face
function baPlug(T, K, x, y, o = {}) {
  const s = o.s ?? BA_PS;
  for (const c of [T, K]) { c.save(); c.translate(x, y); c.rotate((o.rot || 0) * D2R); c.scale(o.sx ?? 1, o.sy ?? 1); }
  plugHead(T, K, 0, 0, { s, name: o.name, lit: o.lit });
  baBadge(K, 0, 0, s, o.img, o.imgA ?? 1);
  for (const c of [T, K]) c.restore();
}
function baBadge(K, x, y, s, img, a = 1) {              // avatar tile on a plug face (plug-local coords, plug origin at x,y)
  const im = img && IMG[img];
  if (!im || a <= 0.01) return;
  K.save(); K.translate(x, y); K.scale(s, s); K.globalAlpha *= a;
  coverImg(K, im, -25, -62, 50, 50, { r: 10, fx: 0.5, fy: 0.5 });
  strokeRR(K, -25, -62, 50, 50, 10, 'rgba(255,255,255,0.18)', 2.5);
  K.restore();
}
// plug-in impact: red halftone bloom, shock ring, two bursts and gravity sparks
function baImpact(T, K, x, y, dt, s = 1, seed = 1) {
  if (dt < 0 || dt > 0.8) return;
  baGlow(T, x, y, 240 * s, 160 * s, 0.9 * Math.exp(-dt * 4.2), '255,0,0');
  shock(K, x, y, dt, { r: 175 * s, color: C.red, lw: 6 * s, dur: 0.42 });
  burst(K, x, y - 8 * s, dt, { n: 12, r0: 54 * s, r1: 178 * s, color: C.red, lw: 7 * s, dur: 0.3, rot: -0.12 });
  burst(K, x, y - 8 * s, dt - 0.035, { n: 7, r0: 84 * s, r1: 150 * s, color: C.ink, lw: 4 * s, dur: 0.26, rot: 0.33 });
  const R = rng(seed * 7919 + 11);
  for (let i = 0; i < 18; i++) {
    const ang = -Math.PI * (0.06 + 0.88 * R()), v = (430 + 680 * R()) * s, life = 0.26 + 0.36 * R(), col = R() < 0.74 ? C.red : C.ink;
    if (dt > life) continue;
    const k = 1 - dt / life, gr = 2600 * s;
    const vx = Math.cos(ang) * v, vy = Math.sin(ang) * v + gr * dt;
    const px = x + Math.cos(ang) * v * dt, py = y + Math.sin(ang) * v * dt + 0.5 * gr * dt * dt;
    line(K, px - vx * 0.024, py - vy * 0.024, px, py, col, (2 + 3.6 * k) * s, 'round');
  }
}
// halftone dust puff on T (slams / drops)
function baPuff(T, x, y, dt, s = 1, dir = 1) {
  if (dt < 0 || dt > 0.55) return;
  const p = dt / 0.55, e = E.outCubic(p);
  for (let i = 0; i < 4; i++) {
    const r = (16 + i * 8) * s * (0.45 + e), px = x + dir * (i * 24 + 70 * e) * s, py = y - (i % 2) * 12 * s - 26 * e * s;
    T.fillStyle = `rgba(0,0,0,${0.34 * (1 - p)})`; T.beginPath(); T.arc(px, py, r, 0, TAU); T.fill();
  }
}
// "powered panel": the device at the other end of a plug's cable. Card + bottom inlet + power LED; the interior is revealed by
// a power-up wipe that rises from the inlet (boot 0 → 1). o: { t, dark, led, boot, ix (inlet x, local), label, right }
function baPanel(T, K, x, y, w, h, o, body) {
  const dark = !!o.dark, bg = dark ? '#0B0B0C' : '#FFFFFF', dim = dark ? '#8F8F8F' : '#8a8780';
  uiCard(T, K, x, y, w, h, { r: 30, fill: bg, border: dark ? '#0B0B0C' : HAIR, lw: 3 });
  const ix = x + o.ix, iy = y + h;
  const b = clamp(o.boot ?? 1), rv = (h - 4) * E.outCubic(b), top = y + h - rv;
  if (!dark && b < 1) { K.save(); rr(K, x, y, w, h, 30); K.clip(); K.fillStyle = 'rgba(17,17,17,0.08)'; K.fillRect(x, y, w, h - rv); K.restore(); }
  if (b > 0) {
    K.save(); rr(K, x, y, w, h, 30); K.clip(); K.beginPath(); K.rect(x, top, w, rv); K.clip();
    text(K, o.label || '', x + 62, y + 46, { font: F.mono, weight: 500, size: 22, color: dim, align: 'left' });
    text(K, o.right || '', x + w - 32, y + 46, { font: F.mono, weight: 500, size: 21, color: dim, align: 'right' });
    line(K, x, y + 72, x + w, y + 72, dark ? '#232325' : 'rgba(17,17,17,0.09)', 2, 'butt');
    body(x, y);
    K.restore();
    if (b < 1) {                                             // the rising power edge
      K.save(); rr(K, x, y, w, h, 30); K.clip();
      const gr = K.createLinearGradient(0, top, 0, top + 90); gr.addColorStop(0, 'rgba(255,59,31,0.28)'); gr.addColorStop(1, 'rgba(255,59,31,0)');
      K.fillStyle = gr; K.fillRect(x, top, w, 90); K.restore();
      line(K, x + 14, top, x + w - 14, top, C.red, 4, 'butt');
    }
  }
  // power LED (lights when the lead pulse arrives)
  const led = clamp(o.led ?? 0);
  circle(K, x + 38, y + 38, 10, led > 0.5 ? C.red : (dark ? '#2E2E31' : '#D9D5CC'), dark ? '#3A3A3E' : C.ink, 2.5);
  if (led > 0) baGlow(T, x + 38, y + 38, 60, 60, 0.5 * led, '255,0,0');
  // inlet on the bottom edge, where the cable enters
  fillRR(K, ix - 32, iy - 15, 64, 30, 10, C.ink); strokeRR(K, ix - 32, iy - 15, 64, 30, 10, dark ? '#3A3A3E' : C.ink, 2);
  fillRR(K, ix - 19, iy - 7, 38, 11, 4, '#3A3B41');
  if (led > 0.5) circle(K, ix + 22, iy - 1, 3.5, C.red);
}
// the plugin directory card inside a powered panel (panel-local coords): a centred hero that compacts (c: 0 → 1) into a
// one-row header. o: { c, t0 (boot), W, dark, img, title, pill, sub, num, numLabel, cmd }
function baHero(T, K, t, o) {
  const { c, t0, W: PW, dark } = o;
  const ink = dark ? '#EDEDED' : C.ink, sub = dark ? '#8F8F8F' : '#6b6861';
  // avatar
  const av = lerp(150, 64, c), avx = lerp(PW / 2 - av / 2, 36, c), avy = lerp(104, 96, c);
  const avPop = clamp(pop(t - t0 - 0.04, 2.6, 0.55), 0, 1.2);
  if (avPop > 0) X([T, K], avx + av / 2, avy + av / 2, avPop, 0, () => {
    T.save(); T.shadowColor = 'rgba(0,0,0,0.35)'; T.shadowBlur = 22; T.shadowOffsetY = 12; fillRR(T, -av / 2, -av / 2, av, av, av * 0.22, '#FFFFFF'); T.restore();
    coverImg(K, IMG[o.img], -av / 2, -av / 2, av, av, { r: av * 0.22 });
    if (dark) strokeRR(K, -av / 2, -av / 2, av, av, av * 0.22, '#2C2C30', 2);
  });
  // title + "official" pill
  const tf = { font: F.grot, weight: 700, size: lerp(84, 42, c), ls: -lerp(2.6, 1, c) };
  const pf = { font: F.mono, weight: 700, size: lerp(20, 16, c) }, pw = measure(K, o.pill, pf) + 24, ph = lerp(36, 28, c);
  const tw = measure(K, o.title, tf), gw = tw + 18 + pw;
  const tx = lerp(PW / 2 - gw / 2, 118, c), ty = lerp(344, 126, c);
  const ta = clamp((t - t0 - 0.1) / 0.12);
  K.save(); K.globalAlpha *= ta; K.translate(0, (1 - E.outCubic(ta)) * 24);
  text(K, o.title, tx, ty, Object.assign({ color: ink, align: 'left' }, tf));
  const px = tx + tw + 18, py = ty - tf.size * 0.36 - ph / 2;
  const pp = t - t0 - 0.3, ps = pp <= 0 ? 0 : pp < 0.11 ? lerp(1.8, 1, E.inQuart(pp / 0.11)) : 1 + ring(pp - 0.11, 5, 10) * 0.06;
  if (ps > 0) X([K], px + pw / 2, py + ph / 2, ps, -4, () => { fillRR(K, -pw / 2, -ph / 2, pw, ph, ph / 2, C.red); text(K, o.pill, 0, pf.size * 0.36, Object.assign({ color: '#FFFFFF' }, pf)); });
  const sf = { font: F.mono, weight: 500, size: lerp(26, 20, c) }, sw = measure(K, o.sub, sf);
  text(K, o.sub, lerp(PW / 2 - sw / 2, 120, c), lerp(394, 156, c), Object.assign({ color: sub, align: 'left' }, sf));
  K.restore();
  // installs count-up (plugins.example.com)
  const ia = clamp((t - t0 - 0.16) / 0.1);
  if (ia > 0) {
    const nf = { font: F.grot, weight: 700, size: lerp(116, 42, c), ls: -lerp(4.5, 1.2, c) };
    const fin = o.num.toLocaleString('en-US'), nwF = measure(K, fin, nf);
    const n = Math.round(o.num * E.outCubic(P(t, t0 + 0.16, 1.0))).toLocaleString('en-US');
    const lf = { font: F.mono, weight: 500, size: lerp(27, 20, c) }, lw = measure(K, o.numLabel, lf);
    K.save(); K.globalAlpha *= ia;
    text(K, n, lerp(PW / 2 - nwF / 2, PW - 36 - nwF, c), lerp(534, 128, c), Object.assign({ color: ink, align: 'left' }, nf));
    text(K, o.numLabel, lerp(PW / 2 - lw / 2, PW - 36 - lw, c), lerp(580, 156, c), Object.assign({ color: sub, align: 'left' }, lf));
    K.restore();
  }
  // install command (hero only; leaves early in the compaction)
  const cf = { font: F.mono, weight: 700, size: 21 }, cw = measure(K, o.cmd, cf) + 32;
  const ca = clamp((t - t0 - 0.4) / 0.12) * (1 - clamp(c * 3));
  if (ca > 0) {
    K.save(); K.globalAlpha *= ca; K.translate(0, (1 - E.outCubic(clamp((t - t0 - 0.4) / 0.2))) * 18 + c * 40);
    codeChip(K, o.cmd, PW / 2 - cw / 2, 648, { size: 21, fill: dark ? '#1E1E21' : CC.bg, color: dark ? '#EDEDED' : CC.text });
    K.restore();
  }
  if (c > 0.5) line(K, 0, 186, PW * E.outCubic((c - 0.5) * 2), 186, dark ? '#232325' : 'rgba(17,17,17,0.09)', 2, 'butt');
}
// a halftone-looking drop shadow drawn on K (for props that sit on top of another K card, where a T shadow would be hidden)
let BA_DOTS = null;
function baDotShadow(K, x, y, w, h, r, dense = 1) {
  if (!BA_DOTS) {
    BA_DOTS = [1.05, 1.6, 2.05].map(rad => { const c = document.createElement('canvas'); c.width = c.height = 5; const g = c.getContext('2d'); g.fillStyle = '#111111'; g.beginPath(); g.arc(2.5, 2.5, rad, 0, TAU); g.fill(); return c; });
  }
  K.save();
  [[18, 0], [11, 1], [5, 2]].forEach(([grow, k]) => {
    if (k === 2 && dense < 0.6) return;
    K.fillStyle = K.createPattern(BA_DOTS[k], 'repeat');
    fillRR(K, x - grow * 0.5 + 10, y - grow * 0.5 + 16, w + grow, h + grow, r + grow * 0.5, K.fillStyle);
  });
  K.restore();
}
// eased typing that follows word timestamps: segs = [[str, t0, t1], …] → the visible prefix at t
function baTypeSeg(t, segs) {
  let s = '';
  for (const [str, t0, t1] of segs) { if (t < t0) break; s += str.slice(0, Math.ceil(str.length * clamp((t - t0) / Math.max(0.01, t1 - t0)))); }
  return s;
}
// The presenter's approximate shoulder (scene coords) and the pointAng that aims an arm at (tx, ty)
const baShoulder = (gx, gy, gs, side) => [gx + (side === 'L' ? -226 : 226) * gs, gy - 264 * gs];
function baAim(gx, gy, gs, side, tx, ty) {
  const [sx, sy] = baShoulder(gx, gy, gs, side), dx = tx - sx, dy = ty - sy;
  return Math.atan2(dy, side === 'L' ? -dx : dx) / D2R;
}

// ─────────────── the hook ───────────────
(() => {
  const CUT = wi(13) - 0.1;                                  // 3.54: db scene starts
  const BIG = { cx: 540, by: 1030, s: 1.6 };                 // centre stage (strip spans x 28 – 1052, y 822 – 1030)
  const LAND = 0.15;                                         // slam impact
  const T_VIBE = wi(2) + 0.02;                               // "vibe coding": master LED sputters and dies
  const T_NAME = wi(5) - 0.02;                               // "Claude Code": label underlined
  const T_HALT = wi(7);                                      // "until": "no" shake, meter boxed in red
  const T_REACH = wi(8) - 0.08;                              // "you've installed": the presenter reaches up
  const T_P = [wi(11) - 0.03, wi(11) + 0.07, wi(12) - 0.01, wi(12) + 0.09];   // 2.89 2.99 3.09 3.19 · sockets pulse on "four plugins"
  const D0 = 3.15, D1 = 3.5;                                 // dock move
  const TX = 790, TY = 2012, TS = 0.95;                      // The presenter's hook spot (under the strip, right of centre)
  kick(LAND, 0.8, 0.9);                                      // the one punch: the strip slams down

  const dockM = t => E.inOutCubic(P(t, D0, D1 - D0));
  const dockX = t => E.inOutCubic(clamp(P(t, D0, D1 - D0) / 0.72));          // sideways + shrink first …
  const dockY = t => E.inOutCubic(clamp((P(t, D0, D1 - D0) - 0.2) / 0.8));   // … then down, so it never crosses the presenter's face
  function geom(t) {
    let g;
    if (t < LAND) {                                          // falls from above the camera, rotating, in-quart
      const q = E.inQuart(clamp(t / LAND));
      g = baG(BIG.cx + (1 - q) * 50, BIG.by - (1 - q) * 330, BIG.s * lerp(1.34, 1, q), { r: lerp(-9, 0, q) });
    } else {
      const d = t - LAND, sq = Math.exp(-8.5 * d) * Math.cos(TAU * 3.2 * d);
      const shake = Math.sin((t - T_HALT) * 40) * win(t, T_HALT - 0.02, T_HALT + 0.26, 0.04, 0.12);
      const lean = E.inOutCubic(P(t, T_REACH, 0.5));
      const bob = Math.sin((t - LAND) * 3.4) * 7 * clamp(d / 0.35);
      g = baG(BIG.cx + shake * 15, BIG.by + bob - lean * 18, BIG.s, {
        r: 1.6 * Math.sin(TAU * 2.1 * d) * Math.exp(-5.5 * d) + shake * 1.8 + lean * 1.6 + 0.7 * Math.sin(t * 2.2) * clamp(d / 0.4),
        sy: 1 - 0.11 * sq, sx: 1 + 0.035 * sq });
    }
    const m = dockM(t);
    if (m > 0) {
      const kx = dockX(t), ky = dockY(t), y0 = g.y + g.s * STRIP_H;
      g = baLerpG(g, BA_DOCK, kx);
      g.y = lerp(y0, BA_DOCK.y + BA_DOCK.s * STRIP_H, ky) - g.s * STRIP_H;     // bottom edge follows the late y-ease
      g.r += Math.sin(Math.PI * m) * 5;
    }
    return g;
  }

  // master LED sputter: tries to power on, fails
  const SPUT = [[0, 0.05, 1], [0.09, 0.12, 0.8], [0.2, 0.23, 0.55], [0.34, 0.36, 0.3]];
  const sputter = t => { const d = t - T_VIBE; let v = 0; for (const [a, b, k] of SPUT) if (d >= a && d < b) v = k; return v; };

  function ghostPlug(K, t, i, fade) {                        // dashed plug silhouette that drops over socket i
    const dt = t - T_P[i];
    if (dt < 0 || fade <= 0) return;
    const pp = pop(dt, 3.2, 0.5), bob = Math.sin((t + i * 0.45) * 6) * 2.5;
    const y0 = BA_SEAT_Y - 30 - (1 - pp) * 70 + bob;
    K.save(); K.globalAlpha *= clamp(dt / 0.05) * fade;
    K.translate(socketX(i), y0); K.scale(BA_PS, BA_PS);
    K.setLineDash([10, 8]); K.lineDashOffset = -t * 40;
    strokeRR(K, -38, -110, 76, 110, 16, C.red, 4);
    [-14, 14].forEach(px => strokeRR(K, px - 5, -2, 10, 26, 3, C.red, 3));
    K.setLineDash([]);
    text(K, '0' + (i + 1), 0, -42, { font: F.mono, weight: 700, size: 30, color: C.red });
    K.restore();
  }

  function draw(T, K, t) {
    if (t >= D1) { baDockStrip(T, K, t); return; }
    const g = geom(t), m = dockM(t), ex = 1 - E.inOutCubic(P(t, D0 - 0.02, 0.26));
    const d = t - LAND;
    // slam: halftone dust at both feet + a rectangular ink shockwave off the strip
    const [lx, ly] = baPt(g, 30, STRIP_H), [rx] = baPt(g, STRIP_W - 30, STRIP_H);
    baPuff(T, lx, ly, d, 1.3, -1); baPuff(T, rx, ly, d, 1.3, 1);
    baIn([T, K], g, () => {
      powerStrip(T, K, 0, 0, 1, { t, p: [0, 0, 0, 0] });
      if (d >= 0 && d < 0.34) {
        const p = d / 0.34, e = E.outCubic(p) * 44;
        K.save(); K.globalAlpha *= 1 - p; strokeRR(K, -e, -e, STRIP_W + 2 * e, STRIP_H + 2 * e, 34 + e * 0.5, C.ink, 5 * (1 - p) + 1); K.restore();
      }
      // "vibe coding": master LED sputters (never catches)
      const sp = sputter(t);
      if (sp > 0) { circle(K, 44, 44, 11, `rgba(255,59,31,${sp})`, C.ink, 3); baGlow(T, 44, 44, 70, 70, 0.55 * sp, '255,0,0'); }
      if (t > T_VIBE && t < T_VIBE + 0.5) {                  // tiny "fizzle" ticks off the LED
        burst(K, 44, 44, t - T_VIBE - 0.02, { n: 6, r0: 18, r1: 36, color: '#9A968D', lw: 2.5, dur: 0.22 });
      }
      // "Claude Code": red underline sweeps under the label
      const nw = measure(K, 'CLAUDE CODE', { font: F.mono, weight: 700, size: 17 });
      const up = E.outCubic(P(t, T_NAME, 0.22)) * ex;
      if (up > 0) { K.save(); K.globalAlpha *= ex; line(K, 64, 59, 64 + (nw + 4) * up, 59, C.red, 3.5, 'round'); K.restore(); }
      // "until": the 0/4 meter gets a red box (drawn on) and blinks
      const bx = 56, by = 62, bw = 64, bh = 38, per = 2 * (bw + bh);
      const bp = E.outCubic(P(t, T_HALT + 0.02, 0.22)) * ex;
      if (bp > 0) {
        const blink = t < T_HALT + 0.5 ? (Math.floor((t - T_HALT) * 12) % 2 ? 0.35 : 1) : 1;
        K.save(); K.globalAlpha *= blink; K.setLineDash([per * bp, per]); strokeRR(K, bx, by, bw, bh, 8, C.red, 3); K.restore();
      }
      // "four plugins": each socket pulses (flash + ring + LED blink) and a dashed ghost plug drops over it
      for (let i = 0; i < 4; i++) {
        const dt = t - T_P[i], sx = socketX(i), sy = BA_SOCK_Y;
        if (dt >= 0 && dt < 0.6) {
          const e = E.outCubic(dt / 0.6) * 30, a = 1 - dt / 0.6;
          fillRR(K, sx - 42, sy - 42, 84, 84, 18, `rgba(255,59,31,${0.3 * Math.exp(-dt * 7)})`);
          K.save(); K.globalAlpha *= a; strokeRR(K, sx - 42 - e, sy - 42 - e, 84 + 2 * e, 84 + 2 * e, 18 + e * 0.5, C.red, 4); K.restore();
          if (dt < 0.3) circle(K, sx + 30, sy - 30, 5, C.red);
          baGlow(T, sx, sy, 110, 110, 0.5 * Math.exp(-dt * 5), '255,0,0');
        }
        ghostPlug(K, t, i, ex);
      }
    });
  }

  SC.hook = {
    label: '// 00 — before you start', bg: 'light',
    // slow push while the presenter reaches; back to identity before the dock so the hand-off is exact
    cam: t => ({ z: 1 + 0.035 * win(t, 1.8, 2.95, 0.9, 0.22) }),
    draw,
    guy(t) {
      const ent = (1 - pop(t + 0.06, 1.7, 0.8)) * 1000;              // rises in from frame 0
      const m = dockM(t);
      if (t >= D1) return { x: PRESENTER_DOCK.x, y: PRESENTER_DOCK.y, s: PRESENTER_DOCK.s };
      const kx = dockX(t);
      const x = lerp(TX, PRESENTER_DOCK.x, kx), s = lerp(TS, PRESENTER_DOCK.s, kx), y = lerp(TY, PRESENTER_DOCK.y, m) + ent * (1 - m);
      // the reaching arm points up-left at the strip, then ticks once per socket pulse (counting them off)
      let aim = -56;
      for (let i = 0; i < 4; i++) aim -= 6 * clamp(pop(t - T_P[i], 3.4, 0.45), 0, 1.3);
      const wag = -86 + 11 * Math.sin((t - 0.1) * 21);               // "Don't": finger wag
      return Object.assign({ x, y, s },
        arms(t, [
          [0.12, 1.02, 'R', 'point', { pointAng: wag }],
          [T_HALT - 0.1, T_REACH + 0.12, 'R', 'wave', { wave: 0 }],   // "until": stop palm
          [T_REACH, D0 - 0.08, 'L', 'point', { pointAng: aim }],       // reaching up at the strip, then counting the sockets
        ]),
        expr(t, [
          [0.05, T_VIBE - 0.05, { brow: -0.45, smile: -0.25 }],
          [T_VIBE - 0.05, T_NAME, { browTilt: 0.55, smile: 0.35 }],   // skeptical smirk at "vibe coding"
          [T_NAME, T_HALT - 0.05, { brow: 0.35, smile: 0.1 }],
          [T_HALT - 0.05, T_REACH, { brow: -0.7, smile: -0.55 }],
          [T_REACH, D0 - 0.05, { brow: 0.75, smile: 0.7 }],
        ]),
        {
          headTurn: 0.14 * Math.sin(t * 19) * win(t, 0.05, 0.5, 0.06, 0.12) - 0.1 * win(t, T_REACH, D0),
          headTilt: 4 * win(t, T_VIBE, T_NAME) - 3 * win(t, T_HALT, T_REACH) + 3 * win(t, T_P[0], D0),
          lookX: -0.25 * win(t, T_NAME, T_HALT) - 0.3 * win(t, T_REACH, D0),
          lookY: -0.7 * win(t, 0.3, D0 - 0.05, 0.2, 0.2),
          shock: 0.35 * win(t, LAND, LAND + 0.3, 0.03, 0.2),
        });
    },
  };
})();
