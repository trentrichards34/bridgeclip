// ═════════════ 01 · HOOK  [0 → CUT_MIDDLE] · classic · PATTERN SKELETON (build-up stage) ═════════════
// This file is a PATTERN, not a finished look. KEEP its grammar, REPLACE its props with a metaphor invented for your script:
//   · frame 0 is already moving: the central object DROPS while the presenter springs up
//   · the stage BUILDS UP: every stressed word of the hook (tplBeats) adds one element or changes one; earlier elements stay and live
//   · the newest element is the focus: the presenter points at it (ST.focus), the camera leans to it (stageCam)
//   · the last build-up word strains everything (presenter PANICS), the key word of sentence 2 is the one big kick: the stage breaks,
//     a STAMP slams, presenter SHOCK then shakes his head "no" · dot wipe into the middle (timeline.js)
// Placeholder metaphor below (plain on purpose so a lazy run still moves well): the PROBLEM OBJECT, a labelled card, takes one HIT per
//   stressed word (a chip with that word strikes it: crack, shake, strain bar climbs, then the chip hangs off its pin swinging) and
//   SHATTERS on the stamp word. `reel craft` ignores this file while it is identical to the template, so an untouched copy fails the
//   craft bar: invent this script's own objects (guides/patterns.md) and draw them in the metaphor block.
// Keeps moving: the strain bar + odometer, the live timer, cracks breathing red at max, chips swinging, idle float, camera lean.
(() => {
  const S0 = 0, S1 = CUT_MIDDLE;
  const LAND = 0.14;                                                   // the central object's impact (frame 0 is already falling)
  const s1 = SENTENCES[1] && SENTENCES[1].s < S1 - 0.3 ? SENTENCES[1] : null;
  // the stamp: sentence 2's key word (hold it ≥ ~0.5 s before the wipe covers the frame)
  let iStamp = s1 ? keyWordIdx(s1.i0, s1.i1) : -1;
  if (iStamp < 0) { const b = tplBeats(lerp(S0, S1, 0.5), S1 - 0.5, 1); iStamp = b.length ? b[0].i : -1; }
  const T_STAMP = clamp(iStamp >= 0 ? Math.max(s1 ? s1.s : 0, Math.min(WORDS[iStamp].s, S1 - 0.74)) : lerp(LAND, S1, 0.62), LAND + 0.9, Math.max(LAND + 0.9, S1 - 0.45));
  const STAMP = (iStamp >= 0 ? tplWord(iStamp, 10) : '') || uiText('nope').toUpperCase();
  // 3-4 build-up beats before the stamp (stressed words; fallback: a word in the widest gap, else its middle)
  const span = T_STAMP - 0.3 - (LAND + 0.25), NB = span > 1.5 ? 4 : 3;
  let B = tplBeats(LAND + 0.25, T_STAMP - 0.3, NB, Math.min(0.42, span / NB)).map(q => ({ t: q.t, w: tplWord(q.i, 9) }));
  while (B.length < NB) {
    const ts = [LAND + 0.25, ...B.map(b => b.t), T_STAMP - 0.3];
    let k = 0; for (let j = 1; j + 1 < ts.length; j++) if (ts[j + 1] - ts[j] > ts[k + 1] - ts[k]) k = j;
    const a = ts[k] + 0.2, b = ts[k + 1] - 0.2;
    let wI = -1; for (let i = 0; i < WORDS.length; i++) if (WORDS[i].s > a && WORDS[i].s < b && !isStopWord(WORDS[i].w) && (wI < 0 || cleanWord(i).length > cleanWord(wI).length)) wI = i;
    B.push(wI >= 0 ? { t: WORDS[wI].s, w: tplWord(wI, 9) } : { t: (ts[k] + ts[k + 1]) / 2, w: '' });
    B.sort((p, q) => p.t - q.t);
  }
  const T_MAX = B[NB - 1].t;

  // ── THIS REEL'S METAPHOR: replace these props with ones invented for the script (guides/patterns.md) ──
  // What a real reel puts here: 2-5 custom drawing functions for objects that ARE this script's idea (a power strip for "4 plugins",
  // a clothesline of ID badges for "you do 6 jobs", a REC frame for "scared to show your face"), each with an entrance, a reaction
  // to its words and an idle life, built from the primitives (springTo, pendulum, gravityFall, ring, idleSway...).
  const PROB = { w: 560, h: 420 };                                     // the problem object (local coords, centred on 0,0)
  const PTITLE = tplWord(keyWordIdx(SENTENCES[0].i0, SENTENCES[0].i1), 11) || uiText('sceneProblem').toUpperCase();
  const LEVEL = [[0, 0.06], ...B.map((b, k) => [b.t, 0.12 + 0.85 * (k + 1) / NB])];   // strain per hit
  const HIT_Y = B.map((_, k) => -130 + k * (260 / Math.max(1, NB - 1)));             // where each chip strikes the right edge
  const CHIP = { x: 820, y0: 640, dy: 128, w: 300, h: 92 };

  // a crack from the struck edge into the card: a seeded zig-zag that grows in 0.1 s (local coords of the card)
  function hkCrack(K, k, p, col) {
    const R = rng(31 + k * 7); let x = PROB.w / 2, y = HIT_Y[k], an = Math.PI + (R() - 0.5) * 0.7;
    K.save(); K.strokeStyle = col; K.lineWidth = 4; K.lineCap = 'round'; K.lineJoin = 'round'; K.beginPath(); K.moveTo(x, y);
    for (let j = 0; j < 5; j++) { an += (R() - 0.5) * 1.1; const l = (34 + R() * 40) * p; x += Math.cos(an) * l; y += Math.sin(an) * l; K.lineTo(x, y); }
    K.stroke(); K.restore();
  }
  // the problem object: plain card, mono header, the hook's key word, a strain bar + odometer that climb on every hit, a live timer.
  // Every hit: a new crack + a recoil shake. At max: red border, jitter, pulsing glow. At the stamp: it SHATTERS (hkShards).
  function hkProblem(T, K, t) {
    if (t >= T_STAMP + 0.02) { hkShards(T, K, t); return; }
    let shake = 0; for (const b of B) shake += ring(t - b.t, 5, 9) * 12;
    const hot = t >= T_MAX, jit = hot ? noise1(t * 34) * 5 : 0, v = springTo(t, LEVEL, 2.2, 0.32);
    const x0 = -PROB.w / 2, y0 = -PROB.h / 2;
    X([T, K], shake + jit, 0, 1, shake * 0.12, () => {
      if (hot) glow(T, 0, 20, PROB.w * 0.9, PROB.h * 0.8, 0.6 + 0.2 * Math.sin(t * 20));
      uiCard(T, K, x0, y0, PROB.w, PROB.h, { r: 30, border: hot ? C.red : C.ink, lw: 4 });
      text(K, '// ' + uiText('sceneProblem'), x0 + 32, y0 + 54, { font: F.mono, weight: 700, size: 22, color: '#8a8780', align: 'left' });
      liveDot(K, -x0 - 120, y0 + 46, 7, t);
      const sec = Math.floor(t * 37);
      text(K, '00:' + String(sec % 60).padStart(2, '0'), -x0 - 32, y0 + 54, { font: F.mono, weight: 700, size: 22, color: C.ink, align: 'right' });
      const lf = { font: F.grot, weight: 700, size: PTITLE.length > 8 ? 78 : 96, color: hot ? C.red : C.ink, align: 'left', ls: -3 };
      X([K], x0 + 32, y0 + 168, 1 + ring(t - T_MAX, 4, 9) * 0.12, 0, () => text(K, PTITLE, 0, 0, lf));
      // strain bar (fills on every hit, overshoots) + its rolling number
      const bx = x0 + 32, by = y0 + PROB.h - 120, bw = PROB.w - 64;
      fillRR(K, bx, by, bw, 34, 17, '#EFEBE2');
      fillRR(K, bx, by, Math.max(34, bw * clamp(v, 0, 1.04)), 34, 17, v > 0.75 ? C.red : C.ink);
      odometer(K, clamp(v) * 100, bx, by + 96, { size: 52, color: v > 0.75 ? C.red : C.ink, suffix: '%', vel: (springTo(t + 0.02, LEVEL, 2.2, 0.32) - springTo(t - 0.02, LEVEL, 2.2, 0.32)) * 2500 });
      B.forEach((b, k) => { if (t >= b.t) hkCrack(K, k, clamp((t - b.t) / 0.1), hot ? C.red : C.ink); });
      B.forEach(b => burst(K, PROB.w / 2, HIT_Y[B.indexOf(b)], t - b.t, { n: 10, r0: 20, r1: 110, color: C.red, lw: 6, dur: 0.3 }));
    });
  }
  // the shatter: the card splits into a 3×2 grid of jagged shards, each falls with gravity + spin, staggered
  function hkShards(T, K, t) {
    const R = rng(5), cols = 3, rows = 2, cw = PROB.w / cols, ch = PROB.h / rows, J = [];
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) J.push([-PROB.w / 2 + i * cw + (i % cols ? (R() - 0.5) * 60 : 0), -PROB.h / 2 + j * ch + (j % rows ? (R() - 0.5) * 50 : 0)]);
    const at = (i, j) => J[j * (cols + 1) + i];
    burst(K, 0, 0, t - T_STAMP, { n: 16, r0: 60, r1: 320, color: C.ink, lw: 8, dur: 0.4 });
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const q = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)], cx = (q[0][0] + q[2][0]) / 2, cy = (q[0][1] + q[2][1]) / 2, n = j * cols + i;
      const f = gravityFall(t, T_STAMP + 0.02 + n * 0.025, cx * 4.2 + (hash(n) - 0.5) * 300, (cy < 0 ? -260 : 60) - hash(n + 9) * 160, (hash(n + 3) - 0.5) * 420, 5600);
      if (f.dy > 2200) continue;
      X([T, K], cx + f.dx, cy + f.dy, 1, f.r, () => {
        for (const c of [T, K]) { c.beginPath(); q.forEach(([px, py], m) => m ? c.lineTo(px - cx, py - cy) : c.moveTo(px - cx, py - cy)); c.closePath(); }
        T.fillStyle = C.k45; T.fill(); K.fillStyle = '#FFFFFF'; K.fill(); K.strokeStyle = C.ink; K.lineWidth = 4; K.lineJoin = 'round'; K.stroke();
      });
    }
  }
  // a hit chip: appears ON the struck edge on its word, recoils out to its pin (spring), then hangs and swings (pendulum).
  // Local coords = its hanging spot; (sx, sy) = the strike point relative to it.
  function hkChip(T, K, t, e, k) {
    const b = B[k], dt = t - b.t, sx = 360 + PROB.w / 2 - CHIP.x, sy = 820 + HIT_Y[k] - (CHIP.y0 + k * CHIP.dy);
    const back = springTo(t, [[b.t, 0], [b.t + 0.06, 1]], 2.4, 0.42), ox = lerp(sx, 0, back), oy = lerp(sy, 0, back);
    speedLines(K, ox + CHIP.w * 0.6, oy, 0, clamp(1 - dt / 0.18), { n: 4, len: 120, gap: 22, col: C.ink, lw: 4, seed: k + 2 });
    const sw = pendulum(dt - 0.15, 16 * (k % 2 ? -1 : 1), 1.3, 2.0) + Math.sin(t * 2.4 + k) * 1.5 * clamp(dt - 0.6);
    X([T, K], ox, oy - CHIP.h / 2 - 26, 1, sw, () => {
      line(K, 0, 0, 0, 26, C.ink, 4); circle(K, 0, 0, 8, C.red, C.ink, 3);
      const f = { font: F.grot, weight: 700, size: 40, ls: -1 }, w = Math.max(160, Math.min(CHIP.w, measure(K, b.w || '+1', f) + 90));
      uiCard(T, K, -w / 2, 26, w, CHIP.h, { r: CHIP.h / 2, border: C.ink, lw: 4, fill: e.newest ? C.red : '#FFFFFF' });
      text(K, b.w || '+1', 0, 26 + CHIP.h / 2 + 14, Object.assign({ color: e.newest ? '#FFFFFF' : C.ink, align: 'center' }, f));
    });
  }
  // ── end of the metaphor block ──

  kick(LAND, 0.8, 0.9); kick(T_STAMP + 0.04, 1, 1); kick(T_MAX + 0.02, 0.35, 0.4);
  cue(0, 'whoosh', -2); cue(T_STAMP + 0.02, 'stamp', 0); cue(T_MAX, 'riser', -8); cue(T_STAMP + 0.3, 'thud', -6);
  for (const b of B) cue(b.t, 'thud', -8);

  const ST = buildStage([
    { id: 'problem', t: LAND, x: 360, y: 820, enter: 'drop', sfx: 'thud', gain: 0, idle: 0.6, focus: [0, -40], draw: (T, K, t) => hkProblem(T, K, t) },
    ...B.map((b, k) => ({ id: 'hit' + k, t: b.t, x: CHIP.x, y: CHIP.y0 + k * CHIP.dy, enter: 'none', sfx: null, idle: 0.5, focus: [-40, 0],
      exit: T_STAMP + 0.04 + k * 0.05, exitMode: 'fall', draw: (T, K, t, e) => hkChip(T, K, t, e, k) })),
    { id: 'stamp', t: T_STAMP, x: 380, y: 830, enter: 'none', idle: 0, nudge: 0, sfx: null, focus: [0, 0],
      draw: (T, K, t) => { impact(T, K, 0, 0, t - T_STAMP - 0.04, 1.3, 4); stamp(K, T, STAMP, 0, 0, t - T_STAMP, { size: STAMP.length > 7 ? 92 : 116, rot: -9 }); } },
  ]);
  const OUT = S1 - 0.27;                                               // every mood is over before the wipe: presenter docked at the cut
  const MOODS = [['panic', T_MAX - 0.04, Math.min(T_STAMP - 0.05, OUT)], ['shock', T_STAMP, Math.min(T_STAMP + 0.5, OUT)], ['no', T_STAMP + 0.5, OUT]];
  const clockStr = t => { const m = Math.floor(9 * 60 + 41 + 60 * 6 * phaseAt(t, [[B[NB - 2].t - 0.1, 0.03], [B[NB - 2].t + 0.3, 0.9], [T_MAX, 2.2], [T_STAMP + 0.35, 0.02]])); return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };

  SC.hook = {
    label: '// 01 — ' + uiText('sceneProblem'),
    readout: t => ({ k: uiText('today'), v: clockStr(t), hot: t >= T_MAX }),
    cam: t => {
      const c = stageCam(t, ST, { release: S1 - 0.32 });
      const strain = win(t, T_MAX, T_STAMP, 0.1, 0.05) * (1 - E.inOutCubic(clamp((t - S1 + 0.32) / 0.3)));
      c.x += noise1(t * 30) * 4 * strain; c.z += 0.02 * strain; return c;
    },
    draw(T, K, t) { moodFx(T, K, t, MOODS); ST.draw(T, K, t); },
    guy: t => act(t, mood(t, MOODS, {
      focus: t => ST.focus(t),
      at: t => ({ x: PRESENTER_DOCK.x, y: PRESENTER_DOCK.y + enterY(t, -0.06, 900), s: PRESENTER_DOCK.s }),
    })),
  };
})();
