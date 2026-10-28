// ── EXAMPLE PROP · CLOTHESLINE of ID badges (studied from the creator's "you do 6 jobs" reel: one badge per job word)
// IDEA it visualises: one person wearing many hats / roles piling up, made personal with a clone of the presenter on every badge.
// MOTION TECHNIQUES inside:
//   · the line whips in left → right (outCubic 0.34 s) and SAGS with every card that lands: sag += weight·pop(t - c.t, 2.2, 0.3),
//     drawn as a parabola, so the line springs under each landing
//   · each badge: 0.16 s fall on its lanyard (length ∝ fp²), then a bungee stretch (len·0.08 + 18)·e^(-6dt)·sin(2π·2.6·dt) and a
//     pendulum swing pendulum(dt, ±14°, 1.15 Hz, k 2.0), alternating sides; squash 0.07·ring(dt, 4, 10)
//   · every newer landing jolts the older badges: 4°·e^(-3.5d)·sin(2π·1.8·d)
//   · snap: the lanyard disappears and the badge falls with gravityFall; ghost: the photo fades to a dashed "?" person
//   · idBadge draws a live presenter clone (PRESENTER.draw with guyState and a per-card face), a status line with liveDot + timer
// IDLE LIFE: sin(t·2.1 + i·1.7)·1.4° sway forever, timers counting, LIVE dots blinking.
// DON'T reuse as-is: build THIS script's own prop with these techniques (guides/patterns.md: invent the metaphor from the script's
// own words, then give it physics, overshoot and idle life like this). Pasting this prop makes every reel look the same, and
// `reel craft` flags it.
// Loading: this file is NOT part of the engine. Only test/classic-showcase loads it (SCENE_FILES '/skill/library/classic/props/...').
// It uses the engine's primitives and private helpers (_mono, _MG, _mA, _mctx from kits/mechanics.js; X, uiCard, glow, burst...).

// ── CLOTHESLINE: a line whips across, cards DROP off clothes-pins on their words (bungee string, pendulum swing, squash), every landing
// loads the line (it sags) and jolts the other cards; cards keep swaying. Default card = an ID badge with a mini presenter clone.
// o: { x0 = -100, x1 = 1180, y = 560, tIn, tOut, cards: [{ t, x, len = 70, w = 270, h = 380, weight = 12, amp = 14, label, sub, status,
//      photo: true | false, face: {smile, brow, ...} (clone expression), ghost: t (photo fades to a dashed '?' person), hot,
//      draw(T, K, w, h, t, card) (custom body, centred), snap: t (lanyard snaps, the card falls) }] }
// → [{x, y}] card centres (scene space), for pointing.
function clothesline(T, K, t, o = {}) {
  const { x0 = -100, x1 = 1180, y = 560, tIn = 0, tOut = null, cards = [], sag0 = 8 } = o;
  const sag = sag0 + cards.reduce((a, c) => a + (c.weight ?? 12) * (pop(t - c.t, 2.2, 0.3) - (c.snap != null ? pop(t - c.snap, 2.6, 0.32) : 0)), 0);
  const lineY = xx => y + sag * 4 * clamp((xx - x0) / (x1 - x0)) * (1 - clamp((xx - x0) / (x1 - x0)));
  const xa = tOut != null ? lerp(x0, x1, E.inCubic(P(t, tOut, 0.3))) : x0, xb = lerp(x0, x1, E.outCubic(P(t, tIn, 0.34)));
  if (xb <= xa + 1) return [];
  K.save(); K.beginPath(); for (let k = 0; k <= 30; k++) { const xx = lerp(xa, xb, k / 30); k ? K.lineTo(xx, lineY(xx)) : K.moveTo(xx, lineY(xx)); }
  K.strokeStyle = C.ink; K.lineWidth = 5; K.lineCap = 'round'; K.stroke(); K.restore();
  const out = [];
  cards.forEach((c, i) => {
    const hx = c.x, hy = lineY(hx), len = c.len ?? 70, bw = c.w ?? 270, bh = c.h ?? 380, FALL = 0.16;
    if (hx > xb || hx < xa) return;
    // the pin is on the line from the start (clipped on when the line passes)
    X([K], hx, hy, clamp(pop(t - tIn - 0.12 - i * 0.04, 3, 0.5), 0, 1.2), 0, () => { fillRR(K, -9, -24, 18, 44, 6, '#F3EEE3'); strokeRR(K, -9, -24, 18, 44, 6, C.ink, 3); line(K, 0, -20, 0, 16, C.ink, 2); circle(K, 0, -2, 4.5, C.red, C.ink, 2); });
    const t0 = c.t - FALL; if (t < t0) return;
    const dt = t - c.t, fp = clamp((t - t0) / FALL);
    let L, th, sc;
    if (dt < 0) { L = len * fp * fp; th = (c.amp ?? 14) * 0.5 * fp; sc = lerp(0.3, 1, E.outCubic(fp)); }
    else { L = len + (len * 0.08 + 18) * Math.exp(-6 * dt) * Math.sin(TAU * 2.6 * dt); th = pendulum(dt, (c.amp ?? 14) * (i % 2 ? -1 : 1), 1.15, 2.0); sc = 1; }
    for (let j = 0; j < cards.length; j++) if (j !== i && t > cards[j].t && cards[j].t > c.t - 0.1) { const d = t - cards[j].t; th += 4 * ((i + j) % 2 ? 1 : -1) * Math.exp(-3.5 * d) * Math.sin(TAU * 1.8 * d); }
    th += Math.sin(t * 2.1 + i * 1.7) * 1.4 * clamp(dt / 0.6);        // idle sway
    const sq = dt >= 0 ? 0.07 * ring(dt, 4, 10) : 0;
    let fx = 0, fy = 0, fr = 0;
    if (c.snap != null && t > c.snap) { const f = gravityFall(t, c.snap, (hash(i + 3) - 0.5) * 500, -200, (i % 2 ? 1 : -1) * 90, 5200); fx = f.dx; fy = f.dy; fr = f.r; if (f.dy > 2200) return; }
    const rad = th * D2R, cxp = hx - Math.sin(rad) * (L + 8 + bh / 2), cyp = hy + Math.cos(rad) * (L + 8 + bh / 2);
    out.push({ x: cxp + fx, y: cyp + fy });
    X([T, K], hx + fx, hy + fy, sc, th + fr, () => {
      if (c.snap == null || t < c.snap) { fillRR(K, -7, 0, 14, L, 3, C.red); line(K, -7, 2, -7, L - 2, C.ink, 2, 'butt'); line(K, 7, 2, 7, L - 2, C.ink, 2, 'butt'); }
      fillRR(K, -11, L - 4, 22, 16, 4, '#BDB7AC'); strokeRR(K, -11, L - 4, 22, 16, 4, C.ink, 2.5);
      for (const cc of [T, K]) { cc.save(); cc.translate(0, L + 8); cc.scale(1 + sq, 1 - sq); }
      if (c.draw) { for (const cc of [T, K]) cc.translate(0, bh / 2); c.draw(T, K, bw, bh, t, c); }
      else idBadge(T, K, bw, bh, t, c, i);
      for (const cc of [T, K]) cc.restore();
    });
  });
  return out;
}
// ID badge hanging from its top-centre (local: clip at 0,0, badge below). c: { label, sub, status, photo, face, hot, t }
function idBadge(T, K, bw, bh, t, c, i = 0) {
  const x = -bw / 2, hot = c.hot ?? (t - c.t < 1.2);
  T.save(); T.shadowColor = 'rgba(0,0,0,0.42)'; T.shadowBlur = 34; T.shadowOffsetY = 20; fillRR(T, x, 0, bw, bh, 22, '#FFFFFF'); T.restore();
  fillRR(K, x, 0, bw, bh, 22, '#FFFFFF'); strokeRR(K, x, 0, bw, bh, 22, C.ink, 4);
  fillRR(K, -30, 14, 60, 12, 6, '#E6E1D6'); strokeRR(K, -30, 14, 60, 12, 6, C.ink, 2.5);
  fillRR(K, x + 14, 38, bw - 28, 50, 12, hot ? C.red : C.ink);
  const lf = { font: F.mono, weight: 700, size: Math.min(28, (bw - 50) / Math.max(4, String(c.label || '').length) * 1.55), ls: 2 };
  text(K, c.label || '', 0, 73, Object.assign({ color: '#FFFFFF' }, lf));
  const PH = { x: x + 14, y: 100, w: bw - 28, h: bh - 196 };
  fillRR(K, PH.x, PH.y, PH.w, PH.h, 14, '#EFE8DA');
  if (c.photo !== false && typeof PRESENTER !== 'undefined' && typeof guyState === 'function') {
    for (const cc of [T, K]) { cc.save(); rr(cc, PH.x, PH.y, PH.w, PH.h, 14); cc.clip(); }
    const cs = PH.w / 760, d = t - c.t;
    const st = guyState(t + i * 0.83 + 0.4, Object.assign({ x: 0, y: PH.y + PH.h + 120 * cs + (1 - pop(d - 0.05, 2.4, 0.5)) * 140, s: cs, t, smile: 0.6, brow: 0.3, mouth: 0.05 }, c.face || {}));
    st.t = t; PRESENTER.draw(T, K, st);
    for (const cc of [T, K]) cc.restore();
  } else if (c.icon) c.icon(K, 0, PH.y + PH.h / 2, PH.h * 0.6, t);
  if (c.ghost != null && t > c.ghost) {                               // the person "doesn't exist": photo fades to a dashed outline + "?"
    const g = clamp((t - c.ghost) / 0.25), cx = 0, cy = PH.y + PH.h * 0.55, u = PH.w / 260;
    _mA([K], g, () => {
      fillRR(K, PH.x, PH.y, PH.w, PH.h, 14, '#EFE8DA');
      K.save(); K.setLineDash([12, 10]); K.lineWidth = 6; K.strokeStyle = '#B3AEA4'; K.lineCap = 'round';
      K.beginPath(); K.arc(cx, cy - 34 * u, 34 * u, 0, TAU); K.stroke();
      K.beginPath(); K.moveTo(cx - 70 * u, PH.y + PH.h); K.quadraticCurveTo(cx - 70 * u, cy + 18 * u, cx, cy + 18 * u); K.quadraticCurveTo(cx + 70 * u, cy + 18 * u, cx + 70 * u, PH.y + PH.h); K.stroke();
      K.restore();
    });
    const qp = pop(t - c.ghost - 0.12, 3, 0.4);
    if (qp > 0) X([K], PH.x + PH.w - 36, PH.y + 40, qp, 10, () => { circle(K, 0, 0, 30, C.red); text(K, '?', 0, 16, { font: F.grot, weight: 700, size: 46, color: '#FFFFFF' }); });
  }
  strokeRR(K, PH.x, PH.y, PH.w, PH.h, 14, C.ink, 3);
  if (c.sub) text(K, c.sub, x + 22, bh - 52, { font: F.serif, italic: true, weight: 400, size: 42, color: C.ink, align: 'left' });
  if (c.status) { liveDot(K, x + 30, bh - 24, 6, t + i); text(K, typeof c.status === 'function' ? c.status(t) : c.status, x + 46, bh - 16, _mono(21, { color: C.ink })); }
}
