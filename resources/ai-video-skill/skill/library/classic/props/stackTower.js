// ── EXAMPLE PROP · STACK TOWER + its default block (studied from the creator's hook: tasks / cups piling up, then toppling)
// IDEA it visualises: load accumulating (tasks, habits, debt) until it can't hold, then collapse.
// MOTION TECHNIQUES inside:
//   · each block falls the last 0.22 s before its word with a quadratic drop (-(dt/0.22)²·800 px), lands with squash
//     ring(d, 4, 10)·0.11 around its bottom edge and dust puffs on both sides
//   · sway GROWS with height: per block angle += sin(t·5.4 + i·0.5)·0.45°·i; every landing adds a jolt ring(t - c.t, 2.6, 5)·1.6°
//     to the blocks above, so the whole column whips
//   · topple: the tower tips (inCubic over 0.32 s, +9°/block), then every block flies with gravityFall (vx 260 + i·150, spin, g 5600),
//     staggered 35 ms per block
//   · towerBlock shrinks its label to fit (measure → scale) so any word works
// IDLE LIFE: the sway never stops once 3+ blocks are up.
// DON'T reuse as-is: build THIS script's own prop with these techniques (guides/patterns.md: invent the metaphor from the script's
// own words, then give it physics, overshoot and idle life like this). Pasting this prop makes every reel look the same, and
// `reel craft` flags it.
// Loading: this file is NOT part of the engine. Only test/classic-showcase loads it (SCENE_FILES '/skill/library/classic/props/...').
// It uses the engine's primitives and private helpers (_mono, _MG, _mA, _mctx from kits/mechanics.js; X, uiCard, glow, burst...).

// ── STACK TOWER: blocks drop on their words (gravity, squash, dust), the tower sways more the higher it gets, jolts on every landing,
// and TOPPLES on a cue (tips, then every block flies with gravity + spin). items [{ t, label, sub, h = 84, w, hot, draw(T, K, w, h, t, b) }]
// o: { items, topple: t, dir: 1 | -1, wobble = 1, w = 330, ground = true } → { top: [x, y], n } (top = where to point)
function stackTower(T, K, x, base, t, o = {}) {
  const { items = [], topple = null, dir = 1, wobble = 1, w = 330, ground = true } = o, DROP = 0.22;
  const n = items.filter(b => t >= b.t).length;
  const tip = topple != null ? E.inCubic(clamp((t - topple) / 0.32)) : 0;
  if (ground) { line(K, x - w * 0.8, base + 4, x + w * 0.8, base + 4, C.ink, 6); for (let i = 0; i < 9; i++) line(K, x - w * 0.75 + i * w * 0.19, base + 10, x - w * 0.75 + i * w * 0.19 - 18, base + 30, '#C9C5BC', 4); }
  let ang = 0, px = x, py = base, top = [x, base];
  items.forEach((b, i) => {
    const d = t - b.t; if (d < -DROP) return;
    const h = b.h || 84, bw = b.w || w;
    let jolt = 0; for (const c of items) if (t > c.t && c !== b) jolt += ring(t - c.t, 2.6, 5) * 1.6;
    ang += (wobble * (Math.sin(t * 5.4 + i * 0.5) * 0.45 * i * Math.min(1, n / 3) + jolt * Math.min(1, i * 0.5)) + tip * 9 * dir) * D2R;
    const dropY = d < 0 ? -Math.pow(-d / DROP, 2) * 800 : 0, sq = d > 0 ? ring(d, 4, 10) * 0.11 : 0;
    const cx = px + Math.sin(ang) * h / 2, cy = py - Math.cos(ang) * h / 2;
    const f = topple != null ? gravityFall(t, topple + 0.26 + i * 0.035, dir * (260 + i * 150 + hash(i) * 120), -260 - i * 50, dir * (160 + hash(i + 5) * 220), 5600) : { dx: 0, dy: 0, r: 0 };
    if (f.dy < 2400) {
      if (d >= 0 && d < 0.55) { puff(T, px - bw / 2, py, d, 0.65, -1); puff(T, px + bw / 2, py, d, 0.65, 1); }
      X([T, K], cx + f.dx, cy + f.dy + dropY, 1, ang / D2R + f.r, () => {
        T.save(); K.save(); for (const c of [T, K]) { c.translate(0, h / 2); c.scale(1 + sq, 1 - sq); c.translate(0, -h / 2); }
        if (b.draw) b.draw(T, K, bw, h, t, b); else towerBlock(T, K, bw, h, b, t);
        T.restore(); K.restore();
      });
    }
    px += Math.sin(ang) * h; py -= Math.cos(ang) * h;
    if (d >= 0) top = [px, py];
  });
  return { top, n };
}
// default block (centred on 0,0, w × h): white card, ink border, accent stripe, label + mono sub. hot = solid accent.
function towerBlock(T, K, w, h, b, t) {
  const hot = b.hot;
  uiCard(T, K, -w / 2, -h / 2, w, h, { r: 16, border: C.ink, lw: 4, fill: hot ? C.red : '#FFFFFF' });
  fillRR(K, -w / 2 + 14, -h / 2 + 14, 10, h - 28, 5, hot ? '#FFFFFF' : C.red);
  const sf = _mono(Math.min(22, h * 0.28), { color: hot ? '#FFE1DA' : _MG, align: 'right' }), sw = b.sub ? measure(_mctx(), b.sub, sf) + 30 : 0;
  const lf = { font: F.grot, weight: 700, size: Math.min(40, h * 0.46), color: hot ? '#FFFFFF' : C.ink, align: 'left', ls: -1 };
  lf.size = Math.max(22, Math.min(lf.size, lf.size * (w - 70 - sw) / Math.max(1, measure(_mctx(), b.label || '', lf))));   // shrink to fit
  text(K, b.label || '', -w / 2 + 42, lf.size * 0.36, lf);
  if (b.sub) text(K, b.sub, w / 2 - 22, 8, sf);
}
