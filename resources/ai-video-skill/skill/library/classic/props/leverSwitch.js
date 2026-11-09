// ── EXAMPLE PROP · LEVER SWITCH (studied from the creator's "turn it on" beats: a decision made physical)
// IDEA it visualises: a binary decision / "flip the switch" / going live.
// MOTION TECHNIQUES inside:
//   · handle angle = springTo(t, flips, f 2.6, z 0.3) between -38° and +38°: snaps over with a clear overshoot and wobble
//   · on every flip: the ON/OFF label pops (1 + ring(t - flipT, 4, 9)·0.2), LED switches, a burst of 12 sparks at the knob
//   · the knob has a T-layer drop shadow so it reads as a physical object lifted off the plate
// IDLE LIFE: none of its own (add idleSway via buildStage, or a pulsing glow while ON).
// DON'T reuse as-is: build THIS script's own prop with these techniques (guides/patterns.md: invent the metaphor from the script's
// own words, then give it physics, overshoot and idle life like this). Pasting this prop makes every reel look the same, and
// `reel craft` flags it.
// Loading: this file is NOT part of the engine. Only test/classic-showcase loads it (SCENE_FILES '/skill/library/classic/props/...').
// It uses the engine's primitives and private helpers (_mono, _MG, _mA, _mctx from kits/mechanics.js; X, uiCard, glow, burst...).

// ── LEVER SWITCH: a big lever on a plate; flips [[t, 0..1], ...] spring the handle (overshoot), sparks + LED on flip.
// o: { flips, labels = ['OFF', 'ON'], title = 'switch', w = 300, h = 400, s, rot } → { x, y, knob: [x, y] }
function leverSwitch(T, K, x, y, t, o = {}) {
  const { flips = [[0, 0]], labels = ['OFF', 'ON'], title = 'switch', w = 300, h = 400, s = 1, rot = 0 } = o;
  const v = springTo(t, flips, 2.6, 0.3);
  let curT = flips[0][0], on = flips[0][1] > 0.5; for (const [ft, fv] of flips) if (t >= ft) { curT = ft; on = fv > 0.5; }
  const ang = lerp(-38, 38, v) * D2R, L = h * 0.42, px = 0, py = h / 2 - 90;
  const knob = [x + Math.sin(ang) * L * s, y + (py - Math.cos(ang) * L) * s];
  X([T, K], x, y, s, rot, () => {
    if (on) glow(T, 0, 0, w * 0.9, h * 0.6, 0.45);
    uiCard(T, K, -w / 2, -h / 2, w, h, { r: 28, border: C.ink, lw: 4 });
    text(K, '// ' + String(title).toUpperCase(), -w / 2 + 26, -h / 2 + 48, _mono(22, { weight: 700 }));
    circle(K, w / 2 - 34, -h / 2 + 40, 11, on ? C.red : '#E3DFD6', C.ink, 3);
    X([K], -w / 2 + 26, -h / 2 + 118, 1 + ring(t - curT, 4, 9) * 0.2, 0, () => text(K, on ? labels[1] : labels[0], 0, 0, { font: F.grot, weight: 700, size: 64, color: on ? C.red : C.ink, align: 'left', ls: -2 }));
    // slot
    K.save(); K.beginPath(); K.arc(px, py, L + 8, -128 * D2R, -52 * D2R); K.strokeStyle = '#E6E3DC'; K.lineWidth = 26; K.lineCap = 'round'; K.stroke(); K.restore();
    text(K, labels[0], px - L * 0.82, py - L * 0.2, _mono(18, { align: 'center' })); text(K, labels[1], px + L * 0.82, py - L * 0.2, _mono(18, { align: 'center', weight: 700, color: C.red }));
    const kx = px + Math.sin(ang) * L, ky = py - Math.cos(ang) * L;
    line(K, px, py, kx, ky, C.ink, 16);
    fillRR(K, px - 60, py - 10, 120, 44, 14, C.ink); circle(K, px, py, 18, '#FFFFFF', C.ink, 5);
    T.save(); T.shadowColor = 'rgba(0,0,0,0.35)'; T.shadowBlur = 14; T.shadowOffsetY = 8; circle(T, kx, ky, 34, '#FFFFFF'); T.restore();
    circle(K, kx, ky, 34, C.red, C.ink, 5); circle(K, kx - 10, ky - 11, 8, 'rgba(255,255,255,0.7)');
    if (t >= curT && curT > flips[0][0]) burst(K, kx, ky, t - curT, { n: 12, r0: 44, r1: 140, color: on ? C.red : C.ink, lw: 6, dur: 0.32 });
  });
  return { x, y, knob };
}
