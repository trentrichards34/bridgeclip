// ── EXAMPLE PROP · POWER STRIP + PLUGS (studied from the creator's "4 plugins" reel: plugins literally plug in)
// IDEA it visualises: add-ons / tools / integrations connecting to one base and powering it up, counted n/4.
// MOTION TECHNIQUES inside:
//   · each plug appears `lead` s (0.7) before its word hanging on a cable and swinging: amp 34°·e^(-2.6dt)·cos(2π·1.25·dt)
//   · anticipation: glides to a hover spot 0.32 s before (inOutCubic 0.18 s), COCKS BACK 26 px (win 0.18-0.08 s before), then SLAMS
//     in 0.1 s with inQuart; squash ring(d, 4, 10)·0.1; burst + shock ring at the socket on the word
//   · the strip jolts on every plug: ring(t - p.t, 3.2, 8)·5 px and 0.6° rot; the n/4 counter pops ring(…, 4, 9)·0.25
//   · master LED sputters on from a table [1,0,1,1,0,1,0,1,1] stepped every 50 ms
//   · flow(): power dots run up the cable after the slam
// IDLE LIFE: power keeps flowing up every live cable; socket LEDs glow.
// DON'T reuse as-is: build THIS script's own prop with these techniques (guides/patterns.md: invent the metaphor from the script's
// own words, then give it physics, overshoot and idle life like this). Pasting this prop makes every reel look the same, and
// `reel craft` flags it.
// Loading: this file is NOT part of the engine. Only test/classic-showcase loads it (SCENE_FILES '/skill/library/classic/props/...').
// It uses the engine's primitives and private helpers (_mono, _MG, _mA, _mctx from kits/mechanics.js; X, uiCard, glow, burst...).

// ── POWER STRIP + PLUGS: plugs swing in on cables from above (pendulum), cock back, SLAM into their socket on the word (sparks, LED on,
// accent glow), then power flows up the cable. o: { n = 4, w = 780, h = 150, plugs: [{ t, socket, label, lead = 0.7, from: [x, y] }],
//   tLive (master LED sputters on), title = 'power', s } → { sockets: [[x, y]], heads: [[x, y] | null] }
function powerStrip(T, K, x, y, t, o = {}) {
  const { n = 4, w = 780, h = 150, plugs = [], tLive = null, title = 'power', s = 1 } = o;
  const gap = (w - 250) / Math.max(1, n - 1), sxL = i => -w / 2 + 210 + i * gap;
  const plugged = plugs.filter(p => t >= p.t).length;
  let jolt = 0; for (const p of plugs) jolt += ring(t - p.t, 3.2, 8) * (t > p.t ? 1 : 0);
  const sockets = [...Array(n)].map((_, i) => [x + sxL(i) * s, y + (-6 + jolt * 5) * s]);
  const live = tLive == null ? 1 : t < tLive ? 0 : (t - tLive < 0.45 ? [1, 0, 1, 1, 0, 1, 0, 1, 1][Math.floor((t - tLive) / 0.05)] : 1);
  X([T, K], x, y + jolt * 5 * s, s, jolt * 0.6, () => {
    if (plugged) glow(T, 0, 0, w * 0.62, h * 1.1, 0.25 + 0.1 * plugged);
    uiCard(T, K, -w / 2, -h / 2, w, h, { r: 36, border: C.ink, lw: 5 });
    circle(K, -w / 2 + 44, -h / 2 + 44, 11, live ? C.red : '#E3DFD6', C.ink, 3);
    if (live) glow(T, -w / 2 + 44, -h / 2 + 44, 40, 40, 0.6);
    text(K, String(title).toUpperCase(), -w / 2 + 66, -h / 2 + 52, _mono(22, { weight: 700, color: C.ink }));
    X([K], -w / 2 + 40, h / 2 - 36, 1 + ring(t - (plugs.filter(p => t >= p.t).slice(-1)[0] || { t: -9 }).t, 4, 9) * 0.25, 0, () =>
      text(K, `${plugged}/${n}`, 0, 0, { font: F.mono, weight: 700, size: 40, color: plugged ? C.red : C.ink, align: 'left' }));
    for (let i = 0; i < n; i++) {
      const sx = sxL(i), on = plugs.some(p => (p.socket ?? plugs.indexOf(p)) === i && t >= p.t);
      fillRR(K, sx - 50, -40, 100, 96, 22, '#F3F1EC'); strokeRR(K, sx - 50, -40, 100, 96, 22, C.ink, 4);
      fillRR(K, sx - 22, -10, 10, 30, 4, C.ink); fillRR(K, sx + 12, -10, 10, 30, 4, C.ink); circle(K, sx, 34, 7, C.ink);
      circle(K, sx, -h / 2 + 22, 7, on ? C.red : '#DDD9D0');
      if (on) glow(T, sx, -h / 2 + 22, 50, 50, 0.7);
    }
  });
  const heads = plugs.map((p, k) => {
    const si = p.socket ?? k, [sx, sy] = sockets[si], lead = p.lead ?? 0.7, tA = p.t - lead;
    if (t < tA) return null;
    const anc = p.from || [sx + 30, -260];
    const seat = [sx, sy - 30 * s];
    // pendulum swing below the anchor, then cock back and slam
    const L = Math.max(80, seat[1] - 230 * s - anc[1]), dt = t - tA;
    const th = (p.amp ?? 34) * Math.exp(-2.6 * dt) * Math.cos(TAU * 1.25 * dt) * D2R;
    const hang = [anc[0] + Math.sin(th) * L, anc[1] + Math.cos(th) * L + (1 - E.outCubic(clamp(dt / 0.3))) * -300];
    const hover = [seat[0], seat[1] - 150 * s];
    const toHover = E.inOutCubic(clamp((t - (p.t - 0.32)) / 0.18)), slam = E.inQuart(clamp((t - (p.t - 0.1)) / 0.1));
    let hx = lerp(hang[0], hover[0], toHover), hy = lerp(hang[1], hover[1], toHover) - 26 * win(t, p.t - 0.18, p.t - 0.08, 0.06, 0.04);
    hx = lerp(hx, seat[0], slam); hy = lerp(hy, seat[1], slam);
    const sq = t > p.t ? ring(t - p.t, 4, 10) * 0.1 : 0;
    const rot = (1 - toHover) * th / D2R * 0.5;
    // cable
    const P = [[hx, hy - 52 * s], [hx, hy - 52 * s - 220], [anc[0], anc[1] + 160], anc];
    cable(K, P, 1, C.ink, 9 * s);
    if (t > p.t) flow(T, K, P, t, p.t + 0.04, { lead: 0.35, r: 4 * s, gap: 46, speed: 300 });
    X([T, K], hx, hy, s, rot, () => {
      T.save(); T.scale(1 + sq, 1 - sq); fillRR(T, -40 + 8, -56 + 10, 80, 92, 18, C.k45); T.restore();
      K.save(); K.scale(1 + sq, 1 - sq);
      fillRR(K, -12, 34, 8, 28, 2, '#BDB7AC'); fillRR(K, 4, 34, 8, 28, 2, '#BDB7AC');
      fillRR(K, -42, -58, 84, 96, 18, C.ink); fillRR(K, -30, -46, 60, 16, 6, C.red);
      fillRR(K, -16, -86, 32, 32, 8, C.ink);
      if (p.label) { const f = { font: F.mono, weight: 700, size: 20, ls: 1 }, tw = measure(K, p.label, f) + 26; fillRR(K, -tw / 2, -6, tw, 34, 10, '#FFFFFF'); text(K, p.label, 0, 18, Object.assign({ color: C.ink }, f)); }
      K.restore();
    });
    if (t >= p.t) { burst(K, seat[0], seat[1] + 40 * s, t - p.t, { n: 12, r0: 50, r1: 150, color: C.red, lw: 7, dur: 0.32 }); shock(K, seat[0], seat[1] + 30 * s, t - p.t, { r: 130, color: C.red, lw: 6, dur: 0.4 }); }
    return [hx, hy];
  });
  return { sockets, heads };
}
