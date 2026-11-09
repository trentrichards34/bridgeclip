// ── EXAMPLE PROP · GAUGE (studied from the creator's solo-founder hook: EFFORT HIGH → MAX → BROKEN, "more effort isn't the fix")
// IDEA it visualises: a quantity being pushed past its limit (effort, stress, risk), then the limit itself failing.
// MOTION TECHNIQUES inside:
//   · needle = springTo(t, steps, f 2.0, z 0.28): very under-damped, it overshoots ~25 % past every level and rings before settling
//   · straining at the stop: + sin(t·63)·0.012 + noise1(t·22)·0.012 jitter, 3 seeded spark ticks per frame off the tip (rng(floor(t·20)))
//   · the level label pops on its word: scale 1 + ring(t - stepT, 4, 9)·0.22
//   · the break: needle falls 0.22 s (outCubic) to 100°, then dangles: pendulum(d - 0.22, 0.45, 1.5 Hz, k 2.2); card shakes
//     ring(d, 6, 7)·4 px; 6 seeded crack polylines grow in 0.12 s from one point; one burst there
// IDLE LIFE: hot glow on T pulsing (0.72 + 0.2·sin(t·22)); the needle never sits still in the hot zone.
// DON'T reuse as-is: build THIS script's own prop with these techniques (guides/patterns.md: invent the metaphor from the script's
// own words, then give it physics, overshoot and idle life like this). Pasting this prop makes every reel look the same, and
// `reel craft` flags it.
// Loading: this file is NOT part of the engine. Only test/classic-showcase loads it (SCENE_FILES '/skill/library/classic/props/...').
// It uses the engine's primitives and private helpers (_mono, _MG, _mA, _mctx from kits/mechanics.js; X, uiCard, glow, burst...).

// ── GAUGE with needle physics. steps [[t, value 0..1, 'LABEL'], ...] · broken: t → glass cracks, needle snaps loose and dangles.
// o: { steps, title, w = 400, h = 470, s, rot, broken, brokenLabel = 'BROKEN', lo = 'low', hi = 'max', hotAt = 0.75 } → {x, y, tip}
function gauge(T, K, x, y, t, o = {}) {
  const { steps = [[0, 0.15, 'LOW']], title = 'effort', w = 400, h = 470, s = 1, rot = 0, broken = null, brokenLabel = 'BROKEN', lo = 'low', hi = 'max', hotAt = 0.75 } = o;
  const keys = steps.map(q => [q[0], q[1]]);
  let cur = steps[0]; for (const q of steps) if (t >= q[0]) cur = q;
  const isB = broken != null && t >= broken, hot = cur[1] >= hotAt || isB;
  const A0 = -205 * D2R, A1 = 25 * D2R, angOf = v => lerp(A0, A1, clamp(v, -0.06, 1.1));
  let v = springTo(t, keys, 2.0, 0.28);
  if (cur[1] >= hotAt && !isB) v += Math.sin(t * 63) * 0.012 + noise1(t * 22) * 0.012;      // straining against the stop
  let ang = angOf(v);
  if (isB) { const d = t - broken, a0 = angOf(1.1); ang = lerp(a0, 100 * D2R, E.outCubic(clamp(d / 0.22))) + pendulum(d - 0.22, 0.45, 1.5, 2.2); }
  const R = w * 0.33, cy = h / 2 - 128;
  const shake = isB ? ring(t - broken, 6, 7) * 4 : 0;
  X([T, K], x + shake * 2, y, s, rot + shake, () => {
    const x0 = -w / 2, y0 = -h / 2;
    if (hot) glow(T, 0, 30, w * 0.95, h * 0.72, isB ? 0.45 : 0.72 + 0.2 * Math.sin(t * 22));
    uiCard(T, K, x0, y0, w, h, { r: 28, border: C.ink, lw: 4 });
    text(K, '// ' + String(title).toUpperCase(), x0 + 30, y0 + 52, _mono(22, { weight: 700 }));
    text(K, Math.round(clamp(isB ? 1 : v) * 100) + '%', -x0 - 30, y0 + 52, _mono(24, { weight: 700, color: hot ? C.red : C.ink, align: 'right' }));
    const lbl = isB ? brokenLabel : (cur[2] || ''), lt = isB ? broken : cur[0];
    const lf = { font: F.grot, weight: 700, size: lbl.length > 6 ? 58 : 76, color: hot ? C.red : C.ink, align: 'left', ls: -2 };
    X([K], x0 + 30, y0 + 140, 1 + ring(t - lt, 4, 9) * 0.22, 0, () => text(K, lbl, 0, 0, lf));
    // dial
    K.save(); K.beginPath(); K.arc(0, cy, R + 46, A0, A1); K.strokeStyle = HAIR; K.lineWidth = 3; K.stroke(); K.restore();
    const N = 16;
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1), an = lerp(A0, A1, u), hz = u >= hotAt - 0.001, lit = isB || u <= v + 0.02, major = i % 3 === 0;
      const r0 = R + 10, r1 = R + (major ? 38 : 28);
      line(K, Math.cos(an) * r0, cy + Math.sin(an) * r0, Math.cos(an) * r1, cy + Math.sin(an) * r1, hz ? (lit ? C.red : 'rgba(255,59,31,0.28)') : (lit ? C.ink : '#DDD9D0'), major ? 8 : 6);
    }
    text(K, lo, Math.cos(A0) * (R + 20), cy + 62, _mono(20, { align: 'center' }));
    text(K, hi, Math.cos(A1) * (R + 20), cy + 62, _mono(20, { weight: 700, color: C.red, align: 'center' }));
    // needle (tapered) + hub
    const L = R + 6, d = [Math.cos(ang), Math.sin(ang)], nx = -d[1], ny = d[0];
    K.beginPath(); K.moveTo(nx * 9, cy + ny * 9); K.lineTo(d[0] * L + nx * 2.5, cy + d[1] * L + ny * 2.5); K.lineTo(d[0] * L - nx * 2.5, cy + d[1] * L - ny * 2.5); K.lineTo(-nx * 9, cy - ny * 9); K.closePath();
    K.fillStyle = C.ink; K.fill();
    line(K, d[0] * L * 0.62, cy + d[1] * L * 0.62, d[0] * L, cy + d[1] * L, C.red, 6);
    circle(K, 0, cy, 22, C.ink); circle(K, 0, cy, 8, '#FFFFFF');
    if (cur[1] >= hotAt && !isB) {                                    // sparks off the stop
      const rr = rng(Math.floor(t * 20) + 3), tx = d[0] * L, ty = cy + d[1] * L;
      for (let k = 0; k < 3; k++) { const an = rr() * TAU, q = 14 + rr() * 26; line(K, tx + Math.cos(an) * q, ty + Math.sin(an) * q, tx + Math.cos(an) * (q + 12), ty + Math.sin(an) * (q + 12), C.red, 4); }
    }
    if (isB) {                                                        // cracked glass + burst
      const rr = rng(77), ox = R * 0.5, oy = cy - R * 0.55, cp = E.outCubic(clamp((t - broken) / 0.12));
      K.save(); K.strokeStyle = C.ink; K.lineWidth = 3; K.lineCap = 'round'; K.lineJoin = 'round';
      for (let k = 0; k < 6; k++) {
        let an = k / 6 * TAU + rr() * 0.6, px = ox, py = oy; K.beginPath(); K.moveTo(px, py);
        const segs = 3 + Math.floor(rr() * 2);
        for (let j = 0; j < segs; j++) { an += (rr() - 0.5) * 0.9; const l = (24 + rr() * 34) * cp; px += Math.cos(an) * l; py += Math.sin(an) * l; K.lineTo(px, py); }
        K.stroke();
      }
      K.restore();
      burst(K, ox, oy, t - broken, { n: 12, r0: 20, r1: 150, color: C.red, lw: 7, dur: 0.36 });
    }
  });
  const tl = [Math.cos(ang) * (R + 6), cy + Math.sin(ang) * (R + 6)];
  return { x, y, tip: [x + tl[0] * s, y + tl[1] * s] };
}
