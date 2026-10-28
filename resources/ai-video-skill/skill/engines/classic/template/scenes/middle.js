// ═════════════ 02 · MIDDLE  [CUT_MIDDLE → CUT_CTA] · classic · PATTERN SKELETON (assembly build-up) ═════════════
// This file is a PATTERN, not a finished look. KEEP its grammar, REPLACE its props with a metaphor invented for your script:
//   · one event per spoken clause of this section (its key word; extra stressed words when the clauses are few), 2-6 events, each cued
//     on the word itself
//   · the stage builds up and nothing freezes: every landed piece keeps an idle life, a LIVE progress card rolls up on every event
//   · the presenter points at the newest piece (focusTrack), leans in on the first one, celebrates on the payoff (kick, confetti)
//   · the camera leans toward each new piece, then releases before the dot wipe into the CTA (timeline.js)
// Placeholder metaphor below (plain on purpose): the SOLUTION OBJECT, an outlined frame with one empty slot per key word; on each
//   word a labelled PART flies in on an arc, slams into its slot (squash, sparks, slot flash) and power starts flowing between the
//   placed parts; on the payoff word the gaps close, the object lights up and a "Done." seal slams. `reel craft` ignores this file
//   while it is identical to the template: invent this script's own objects (guides/patterns.md) in the metaphor block.
// Keeps moving: parts breathe, power dots flow between them, the odometer + sparkline, the LIVE dot, the seal floats.
(() => {
  const S0 = CUT_MIDDLE, S1 = CUT_CTA;
  // the key words: one per clause, topped up with stressed words when the section has few commas, max 6
  const want = clamp(Math.round((S1 - S0) / 1.1), 2, 6);
  let keys = clauses(S0 + 0.05, S1 - 0.3).map(c => c.key).filter(i => WORDS[i].s < S1 - 0.6);
  for (const q of tplBeats(S0 + 0.3, S1 - 0.6, want, 0.5)) if (keys.length < want && keys.every(i => Math.abs(WORDS[i].s - q.t) > 0.5)) keys.push(q.i);
  keys.sort((a, b) => a - b);
  while (keys.length > 6) {                                            // merge the closest neighbours (keep the stronger word)
    let k = 0; for (let i = 1; i + 1 < keys.length; i++) if (WORDS[keys[i + 1]].s - WORDS[keys[i]].s < WORDS[keys[k + 1]].s - WORDS[keys[k]].s) k = i;
    keys.splice(cleanWord(keys[k]).length >= cleanWord(keys[k + 1]).length ? k + 1 : k, 1);
  }
  if (!keys.length) keys = [wordIdxAt(lerp(S0, S1, 0.4))];
  const N = keys.length;
  const EV = keys.map((i, k) => ({ t: Math.max(S0 + 0.45 + k * 0.12, WORDS[i].s), label: tplWord(i, 12) || cleanWord(i).toUpperCase().slice(0, 12) }));
  const LAST = EV[N - 1].t;
  const late = tplBeats(LAST + 0.45, S1 - 0.7, 1);                      // the payoff lands on a word after the last part when there is one
  const T_DONE = clamp(late.length ? late[0].t : LAST + 0.5, LAST + 0.3, Math.max(LAST + 0.3, S1 - 0.6));
  const STAT = { x: 70, y: 1065, w: 500, h: 280 };
  const SEAL = { x: 800, y: 1115 };

  // ── THIS REEL'S METAPHOR: replace these props with ones invented for the script (guides/patterns.md) ──
  // What a real reel puts here: the object that IS this section's idea (plugs going into a strip, badges dropping on a line, a beam
  // tipping, a calendar tearing), with one physical reaction per key word and an idle life, built from the primitives.
  const FR = { x: 90, y: 560, w: 900, h: 430, head: 66 };               // the solution object's frame (scene space)
  const ROWS = N <= 3 ? 1 : 2, COLS = Math.ceil(N / ROWS), GAP = 22;
  const SW = (FR.w - 48 - GAP * (COLS - 1)) / COLS, SH = (FR.h - FR.head - 30 - GAP * (ROWS - 1)) / ROWS;
  // slot k centre; the gaps close (c → 1) when the object is complete
  const mdSlot = (k, c = 0) => {
    const r = Math.floor(k / COLS), q = k % COLS, n = r === ROWS - 1 ? N - r * COLS : COLS, g = GAP * (1 - c);
    const rowW = n * SW + (n - 1) * g, x0 = FR.x + FR.w / 2 - rowW / 2;
    return [x0 + q * (SW + g) + SW / 2, FR.y + FR.head + 14 + r * (SH + GAP) + SH / 2];
  };
  const closeAt = t => E.inOutCubic(P(t, T_DONE - 0.08, 0.25));
  // the frame: outlined card, mono header with an n/N count, a power LED that sputters on at the payoff, an empty dashed slot per part
  function mdFrame(T, K, t) {
    const a = clamp(pop(t - S0 - 0.08, 2.2, 0.55), 0, 1.15), on = t >= T_DONE, c = closeAt(t);
    X([T, K], FR.x + FR.w / 2, FR.y + FR.h / 2, lerp(0.6, 1, a) * (1 + ring(t - T_DONE, 3.5, 7) * 0.03), 0, () => {
      const x0 = -FR.w / 2, y0 = -FR.h / 2;
      if (on) glow(T, 0, 0, FR.w * 0.7, FR.h * 0.8, 0.45 + 0.12 * Math.sin(t * 6));
      uiCard(T, K, x0, y0, FR.w, FR.h, { r: 32, border: on ? C.red : C.ink, lw: 4 });
      const led = on && (t - T_DONE > 0.3 || [1, 0, 1, 1, 0, 1][Math.floor((t - T_DONE) / 0.05)]);
      circle(K, x0 + 40, y0 + 36, 10, led ? C.red : '#E3DFD6', C.ink, 3);
      text(K, '// ' + uiText('sceneHow'), x0 + 64, y0 + 44, { font: F.mono, weight: 700, size: 22, color: C.ink, align: 'left' });
      const n = EV.filter(e => t >= e.t).length, lastT = (EV.filter(e => t >= e.t).slice(-1)[0] || { t: -9 }).t;
      X([K], -x0 - 36, y0 + 44, 1 + ring(t - lastT, 4, 9) * 0.25, 0, () => text(K, `${n}/${N}`, 0, 0, { font: F.mono, weight: 700, size: 30, color: n ? C.red : C.ink, align: 'right' }));
      for (let k = 0; k < N; k++) {                                     // empty slots (dashed), pop in staggered
        const [sx, sy] = mdSlot(k, c), sp = clamp(pop(t - S0 - 0.2 - k * 0.05, 3, 0.5), 0, 1.2), cx = sx - FR.x - FR.w / 2, cy = sy - FR.y - FR.h / 2;
        if (t >= EV[k].t) continue;
        X([K], cx, cy, sp, 0, () => {
          K.save(); K.setLineDash([14, 10]); strokeRR(K, -SW / 2, -SH / 2, SW, SH, 20, '#C9C5BC', 3); K.restore();
          text(K, '0' + (k + 1), 0, 14, { font: F.mono, weight: 700, size: 30, color: '#C9C5BC', align: 'center' });
        });
      }
    });
  }
  // power between placed neighbours: a line with dots running along it (forever)
  function mdPower(K, t) {
    for (let k = 1; k < N; k++) {
      if (t < EV[k].t + 0.1 || Math.floor(k / COLS) !== Math.floor((k - 1) / COLS)) continue;
      const [ax, ay] = mdSlot(k - 1, closeAt(t)), [bx, by] = mdSlot(k, closeAt(t)), x0 = ax + SW / 2 - 6, x1 = bx - SW / 2 + 6;
      line(K, x0, ay, x1, by, C.red, 5);
      for (let j = 0; j < 2; j++) circle(K, lerp(x0, x1, (t * 1.8 + j / 2) % 1), ay, 6, C.red);
    }
  }
  // a part: flies in on an arc the last 0.28 s before its word (spinning down), slams into its slot ON the word (squash, sparks,
  // shock ring), then breathes. Newest part = accent.
  function mdPart(T, K, t, k) {
    const e = EV[k], dt = t - e.t; if (dt < -0.28) return null;
    const [sx, sy] = mdSlot(k, closeAt(t)), side = k % 2 ? 1 : -1, fx = side > 0 ? 1260 : -180, fy = sy - 420;
    let x = sx, y = sy, r = 0, sq = 0;
    if (dt < 0) { const u = E.inCubic((dt + 0.28) / 0.28); x = lerp(fx, sx, u); y = lerp(fy, sy, u) - Math.sin(u * Math.PI) * 120; r = (1 - u) * 160 * side; }
    else { sq = ring(dt, 4, 10) * 0.12; const id = idleSway(t, k * 1.7, 0.35 * clamp((dt - 0.4) / 0.5)); x += id.dx; y += id.dy; r = id.r; }
    const newest = dt >= 0 && EV.every(o => o === e || o.t <= e.t || t < o.t), hot = newest && dt < 1.4;
    if (dt >= 0) { burst(K, sx, sy, dt, { n: 12, r0: SW * 0.4, r1: SW * 0.75, color: C.red, lw: 6, dur: 0.32 }); shock(K, sx, sy, dt, { r: SW * 0.6, color: C.red, lw: 5, dur: 0.4 }); }
    X([T, K], x, y, 1, r, () => {
      for (const c of [T, K]) { c.save(); c.translate(0, SH / 2); c.scale(1 + sq, 1 - sq); c.translate(0, -SH / 2); }
      uiCard(T, K, -SW / 2, -SH / 2, SW, SH, { r: 20, border: C.ink, lw: 4, fill: hot ? C.red : '#FFFFFF' });
      fillRR(K, SW / 2 - 4, -16, 18, 32, 8, hot ? C.ink : C.red);        // the connector nub
      text(K, '0' + (k + 1), -SW / 2 + 22, -SH / 2 + 38, { font: F.mono, weight: 700, size: 22, color: hot ? '#FFE1DA' : '#8a8780', align: 'left' });
      const f = { font: F.grot, weight: 700, size: 46, ls: -1 }; f.size = Math.max(24, Math.min(46, 46 * (SW - 40) / Math.max(1, measure(K, e.label, f))));
      text(K, e.label, 0, f.size * 0.36 + 8, Object.assign({ color: hot ? '#FFFFFF' : C.ink, align: 'center' }, f));
      for (const c of [T, K]) c.restore();
    });
    return [x, y];
  }
  // payoff: a light sweep across the completed object
  function mdSweep(K, t) {
    const p = P(t, T_DONE + 0.05, 0.5); if (p <= 0 || p >= 1) return;
    K.save(); rr(K, FR.x, FR.y, FR.w, FR.h, 32); K.clip();
    const sx = lerp(FR.x - 200, FR.x + FR.w + 200, E.inOutCubic(p));
    K.beginPath(); K.moveTo(sx - 60, FR.y); K.lineTo(sx + 40, FR.y); K.lineTo(sx - 40, FR.y + FR.h); K.lineTo(sx - 140, FR.y + FR.h); K.closePath();
    K.fillStyle = 'rgba(255,255,255,0.55)'; K.fill(); K.restore();
  }
  // ── end of the metaphor block ──

  const KEYS = [[S0, 0], ...EV.map((e, k) => [e.t + 0.05, Math.round(100 * (k + 1) / N)])];
  for (const e of EV) cue(e.t, 'thud', -6);                            // one sound per slam (sparse SFX: the mixer drops crowded cues)
  kick(EV[0].t + 0.02, 0.45, 0.5);
  cue(T_DONE, 'stamp', -2); cue(T_DONE + 0.05, 'shimmer', -8); kick(T_DONE + 0.02, 0.8, 0.7);
  cue(S0 + 0.12, 'swoosh', -6);

  const FOCUS = [[S0 + 0.1, FR.x + FR.w / 2, FR.y + 120], [S0 + 0.35, STAT.x + STAT.w / 2, STAT.y + 120], ...EV.map((e, k) => [e.t, t => mdSlot(k, closeAt(t))[0], t => mdSlot(k, closeAt(t))[1]]), [T_DONE, SEAL.x - 80, SEAL.y - 60]];
  const statY = t => STAT.y + (1 - clamp(pop(t - S0 - 0.25, 2.0, 0.6), 0, 1.2)) * 900;
  const half = EV[Math.floor(N / 2)];
  const MOODS = [['lean', EV[0].t, EV[0].t + 0.6]].concat(N > 3 ? [['lean', half.t, half.t + 0.6]] : [], [['celebrate', T_DONE, Math.min(T_DONE + 0.9, S1 - 0.3)]]);
  const camKeys = [[-1e9, 0, 0], ...EV.map((e, k) => [e.t, (540 - mdSlot(k)[0]) * 0.08, (900 - mdSlot(k)[1]) * 0.05]), [T_DONE, 40, -40]];

  SC.middle = {
    label: '// 02 — ' + uiText('sceneHow'),
    readout: t => ({ k: uiText('doneCount'), v: `${EV.filter(e => t >= e.t).length}/${N}`, hot: t >= EV[0].t }),
    cam: t => {
      const rel = 1 - E.inOutCubic(clamp((t - S1 + 0.3) / 0.3));
      const x = springTo(t, camKeys.map(k => [k[0], k[1]]), 1.3, 0.6), y = springTo(t, camKeys.map(k => [k[0], k[2]]), 1.3, 0.6);
      return { x: x * rel, y: y * rel, z: 1 + (0.03 * E.inOutCubic(P(t, S0, 0.8)) + 0.004 * (t - S0)) * rel };
    },
    draw(T, K, t) {
      moodFx(T, K, t, MOODS);
      // live progress card (rises, odometer rolls on every part, sparkline keeps drawing)
      liveStat(T, K, STAT.x, statY(t), STAT.w, STAT.h, t, { label: uiText('plan'), keys: KEYS, suffix: '%', size: 120, roll: 0.6, hot: tt => tt >= T_DONE, delta: [LAST + 0.2, `${N}/${N}`] });
      if (t >= T_DONE) impact(T, K, SEAL.x, SEAL.y - 30, t - T_DONE - 0.04, 1, 5);
      X([K], SEAL.x, SEAL.y + Math.sin(t * 2.3) * 5 * clamp(t - T_DONE - 0.4), 1, Math.sin(t * 1.9) * 1.5 * clamp(t - T_DONE - 0.4), () => seal(K, uiText('done'), 0, 0, t - T_DONE, { size: 104, rot: -10 }));
      confetti(K, SEAL.x, SEAL.y - 40, t - T_DONE, { seed: 9 });
      // the solution object
      mdFrame(T, K, t);
      mdPower(K, t);
      for (let k = 0; k < N; k++) mdPart(T, K, t, k);
      mdSweep(K, t);
    },
    guy: t => act(t, mood(t, MOODS, { focus: t => focusTrack(t, FOCUS) })),
  };
})();
