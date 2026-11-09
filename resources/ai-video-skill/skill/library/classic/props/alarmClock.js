// ── EXAMPLE PROP · ALARM CLOCK (studied from the creator's solo-founder hook: time pressure, the day whirling away)
// IDEA it visualises: time running out / a routine accelerating / a deadline ringing.
// MOTION TECHNIQUES inside:
//   · minute hand driven by an INTEGRATED speed curve: phaseAt(t, [[t, rev/s], ...]), so it accelerates and brakes smoothly;
//     above ~0.3 rev/s a blur fan (accent wedge behind the hand) + glow fade in (whirl = clamp((speed - 0.3) / 1.2))
//   · second hand ticks with a per-tick overshoot: spring(f, 6, 0.32) clamped to 1.25 inside each 0.5 s tick
//   · rings: win(t, rt, rt + 0.75) drives a 95 rad/s shake of the body (5 px, 0.7° rot), bells rock ±0.14 rad, 2 expanding sound arcs
//   · optional day pill flips (MON → TUE) every 2 revolutions with a clipped roll
// IDLE LIFE: the second hand never stops; bells tremble while it whirls.
// DON'T reuse as-is: build THIS script's own prop with these techniques (guides/patterns.md: invent the metaphor from the script's
// own words, then give it physics, overshoot and idle life like this). Pasting this prop makes every reel look the same, and
// `reel craft` flags it.
// Loading: this file is NOT part of the engine. Only test/classic-showcase loads it (SCENE_FILES '/skill/library/classic/props/...').
// It uses the engine's primitives and private helpers (_mono, _MG, _mA, _mctx from kits/mechanics.js; X, uiCard, glow, burst...).

// ── ALARM CLOCK: ticking second hand, minute hand that whirls with a speed curve, bells that ring on cues.
// o: { speed: [[t, rev/s], ...] (minute-hand revolutions per second; ≥ 0.5 = whirling + blur fan), start = 0.35 rev, tick = 0.5 s,
//      rings: [t, ...] (bells shake + sound arcs 0.9 s), days: true (flipping day pill), label: '6:00' (mono pill under), s, rot } → {x, y}
function alarmClock(T, K, x, y, r, t, o = {}) {
  const { speed = [[0, 0.02]], start = 0.35, tick = 0.5, rings = [], days = false, label = null, s = 1, rot = 0 } = o;
  const rev = start + phaseAt(t, speed), spd = speedAt(t, speed);
  let rw = 0; for (const rt of rings) rw = Math.max(rw, win(t, rt, rt + 0.75, 0.03, 0.2));
  const sh = rw * Math.sin(t * 95) * 5;
  X([T, K], x + sh, y, s, rot + sh * 0.7, () => {
    const whirl = clamp((spd - 0.3) / 1.2);
    if (whirl > 0.05 || rw > 0.05) glow(T, 0, 0, r * 2.1, r * 2.1, 0.6 * Math.max(whirl, rw));
    // bells + hammer
    for (const sg of [-1, 1]) {
      K.save(); K.rotate(sg * 0.62 + (rw > 0 ? Math.sin(t * 70 + sg) * 0.14 * rw : 0) + Math.sin(t * 50) * 0.04 * whirl);
      T.save(); T.rotate(sg * 0.62); T.fillStyle = C.k45; T.beginPath(); T.arc(6, -r - 4, r * 0.27, Math.PI, 0); T.fill(); T.restore();
      K.beginPath(); K.arc(0, -r - 6, r * 0.27, Math.PI, 0); K.closePath(); K.fillStyle = C.ink; K.fill();
      K.restore();
    }
    fillRR(K, -6, -r - 26, 12, 22, 4, C.ink);
    for (const sg of [-1, 1]) { line(K, sg * r * 0.55, r * 0.8, sg * r * 0.78, r * 1.08, C.ink, 9); }
    T.save(); T.shadowColor = 'rgba(0,0,0,0.42)'; T.shadowBlur = 34; T.shadowOffsetY = 20; circle(T, 0, 0, r, '#FFFFFF'); T.restore();
    circle(K, 0, 0, r, '#FFFFFF', C.ink, Math.max(6, r * 0.065));
    for (let i = 0; i < 60; i++) {
      const an = i * TAU / 60, big = i % 5 === 0, r0 = r * (big ? 0.76 : 0.82), r1 = r * 0.88;
      if (!big && r < 120) continue;
      line(K, Math.cos(an) * r0, Math.sin(an) * r0, Math.cos(an) * r1, Math.sin(an) * r1, big ? C.ink : '#C9C5BC', big ? r * 0.04 : r * 0.015);
    }
    const mA = rev * TAU - Math.PI / 2, hA = rev / 12 * TAU - Math.PI / 2 + 2.1;
    if (whirl > 0.05) { const fan = Math.min(2.2, 0.25 + spd * 0.35); K.save(); K.beginPath(); K.moveTo(0, 0); K.arc(0, 0, r * 0.78, mA - fan, mA); K.closePath(); K.fillStyle = `rgba(255,59,31,${0.22 * whirl})`; K.fill(); K.restore(); }
    line(K, 0, 0, Math.cos(hA) * r * 0.46, Math.sin(hA) * r * 0.46, C.ink, r * 0.085);
    line(K, 0, 0, Math.cos(mA) * r * 0.72, Math.sin(mA) * r * 0.72, C.ink, r * 0.055);
    if (whirl < 0.6) {                                                // the ticking second hand (each tick overshoots)
      const n = Math.floor(t / tick), f = t - n * tick, pos = n - 1 + clamp(spring(f, 6, 0.32), 0, 1.25);
      const sA = pos / 60 * TAU * 2 - Math.PI / 2;
      _mA([K], 1 - whirl / 0.6, () => { line(K, -Math.cos(sA) * r * 0.16, -Math.sin(sA) * r * 0.16, Math.cos(sA) * r * 0.8, Math.sin(sA) * r * 0.8, C.red, Math.max(3, r * 0.025)); });
    }
    circle(K, 0, 0, r * 0.08, C.red, C.ink, 3);
    if (rw > 0.05) for (let k = 0; k < 2; k++) {                       // sound arcs
      const q = ((t * 2.6 + k * 0.5) % 1);
      K.save(); K.globalAlpha *= rw * (1 - q); K.strokeStyle = C.red; K.lineWidth = 6; K.lineCap = 'round';
      for (const sg of [-1, 1]) { K.beginPath(); K.arc(0, -r * 0.4, r * (1.25 + q * 0.5), sg > 0 ? -0.9 : Math.PI + 0.9 - 1.0, sg > 0 ? -0.1 : Math.PI + 0.1 - 0.2 + 0.2); K.stroke(); }
      K.restore();
    }
    if (days) {
      const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'], d = Math.floor(rev / 2), df = (rev / 2) % 1, fl = clamp((df - 0.8) / 0.2);
      const pf = { font: F.mono, weight: 700, size: Math.round(r * 0.2), ls: 2 }, ph = r * 0.38, pw = r * 1.1;
      fillRR(K, -pw / 2, r + 28, pw, ph, ph / 2, C.ink);
      K.save(); K.beginPath(); K.rect(-pw / 2, r + 28, pw, ph); K.clip();
      text(K, DAYS[d % 7], 0, r + 28 + ph * 0.7 - fl * ph, Object.assign({ color: C.paper }, pf));
      text(K, DAYS[(d + 1) % 7], 0, r + 28 + ph * 1.7 - fl * ph, Object.assign({ color: C.paper }, pf));
      K.restore();
    } else if (label) {
      const pf = { font: F.mono, weight: 700, size: Math.round(r * 0.2), ls: 1 }, pw = measure(K, label, pf) + 40, ph = r * 0.38;
      fillRR(K, -pw / 2, r + 28, pw, ph, ph / 2, C.ink); text(K, label, 0, r + 28 + ph * 0.7, Object.assign({ color: C.paper }, pf));
    }
  });
  return { x, y };
}
