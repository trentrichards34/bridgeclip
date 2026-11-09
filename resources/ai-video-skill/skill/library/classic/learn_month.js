// ═════════════ 07 · A MONTH  [owi(86)−0.1 ≈ 21.42 → owi(106)−0.1 ≈ 26.18] · orange classic ═════════════
// NOTE: reference code from a real reel. Word indices (wi(n)) refer to that reel's script; re-cue on your own words.json.
// Through-object left in: learnCard() (kit).
// assets not included: none (all vector drawing).
// "You still ship just as fast. The difference is that, a month from now, you'll actually understand your own app."
// Beats: two lane cards whip in, "vibe coding" (learning mode off) over "you + learn-mode" (learning mode on). Same notes app,
// same track: idea → sign in → notes → folders → ship. Both runners launch on "ship", leapfrog, and tie at the finish on "fast"
// ("=" badge on the dashed finish line, both "shipped ✓") → "difference": the camera pushes to the one thing that differs, the
// learning-mode pill (B rings red, A shakes "off", the through-card's tag rings too) → "that, a": the lanes are pushed back and a
// tear-off calendar drops in → "month from now": pages tear off and tumble, OCT 12 → NOV 12 → it shrinks into a "+1 month"
// seam pill and the lanes come back a month later: the same app map in both. A's is fogged (halftone fog, scrambled labels,
// "?" pops, "wait… what does this do?"); B's is crisp (notes ← folder links → folders, ✓ per box as you explain it: "Deleting a
// folder removes its links, not the notes.") → "understand": B's understanding meter 75% → 100% (the one kick) → "your own app":
// A sinks behind B, B takes centre → B is sucked back into the learning-mode card, which bumps. Docked by 26.03.
// Hand-off: 21.42..21.57 and ≥ 26.03 are exactly learnCard(TC) + the presenter at PRESENTER_DOCK, camera identity. Helpers prefixed mo.
(() => {
  const S0 = owi(86) - 0.1, S1 = owi(106) - 0.1, HO = S1 - 0.15;          // 21.42 → 26.18, hand-off from 26.03
  const tShip = owi(88), tFast = owi(91), tThe = owi(92), tDiff = owi(93), tThat = owi(95), tMonth = owi(97), tNow = owi(99);
  const tYoull = owi(100), tAct = owi(101), tUnd = owi(102), tOwn = owi(104);

  // ── timing ──
  const IN = [S0 + 0.16, S0 + 0.23];                    // lane cards whip in
  const TRK = S0 + 0.3;                                 // tracks draw
  const RUN0 = tShip - 0.14, RUN1 = tFast + 0.03;       // 21.84 → 22.60 race
  const TIE = RUN1;
  const DIFF = tDiff + 0.02;                            // 23.15
  const REC = tThat - 0.07;                             // 23.58 lanes pushed back
  const CAL_IN = REC + 0.02;                            // calendar drops
  const FLIP0 = tMonth - 0.04, FLIP1 = tNow + 0.06;     // 23.91 → 24.39 pages tear
  const CAL_OUT = FLIP1 + 0.17;                         // 24.56 → shrinks into the seam pill
  const BACK = CAL_OUT;                                 // lanes return
  const SWAP = REC + 0.3;                               // body swaps race → map while ghosted
  const MAP0 = BACK + 0.08;                             // boxes pop
  const QS = [tYoull + 0.2, tYoull + 0.34, tYoull + 0.48];
  const TYPE0 = tYoull + 0.2, TYPE1 = tUnd + 0.02;
  const CHK = [tAct + 0.08, tAct + 0.22, tUnd];
  const UND = tUnd;
  const DROP = tUnd + 0.24;                             // A sinks behind B
  const FOC = tUnd + 0.28;                              // B takes centre
  const COLL0 = tOwn - 0.07, COLL1 = COLL0 + 0.16;      // 25.78 → 25.94 into the learning card
  kick(UND + 0.02, 0.6, 0.45);

  // ── layout (scene coords) ──
  const CW = 960, CH = 370, AY = 400, BY = 812, CX = 540;
  const SEAM = (AY + CH + BY) / 2;
  const TX0 = 70, TX1 = 820, TY = 250;
  const NODES = [[0.25, 'sign in'], [0.5, 'notes'], [0.75, 'folders'], [1, 'ship']];
  const BOX = [[36, 214, 'notes'], [318, 324, 'folder links'], [714, 210, 'folders']];
  const BY0 = 132, BH = 88;
  const CAL = { x: 540, y: 772, w: 400, h: 470 };
  const TCC = { x: TC.x + TC_W / 2, y: TC.y + TC_H / 2 };
  const PILL_X = 392;
  const MONO = (s, w = 700) => ({ font: F.mono, weight: w, size: s });
  const GROT = (s, w = 700) => ({ font: F.grot, weight: w, size: s });
  const GREY = '#9A968D', LIGHT = '#ECE9E2';

  // ── helpers ──
  function moA(cs, a, fn) { if (a <= 0.002) return; for (const c of cs) { c.save(); c.globalAlpha *= clamp(a); } fn(); for (const c of cs) c.restore(); }
  function moGlow(T, x, y, r, a, red = true) {
    if (a <= 0.003) return;
    const c = red ? '255,0,0' : '0,0,0';
    const g = T.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${c},${Math.min(1, a)})`); g.addColorStop(0.55, `rgba(${c},${Math.min(1, a) * 0.35})`); g.addColorStop(1, `rgba(${c},0)`);
    T.fillStyle = g; T.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function moArrow(K, x1, y, x2, col, lw, p) {
    if (p <= 0) return;
    const xe = lerp(x1, x2, E.outCubic(p)), dir = Math.sign(x2 - x1);
    line(K, x1, y, xe - dir * 6, y, col, lw);
    K.beginPath(); K.moveTo(xe, y); K.lineTo(xe - dir * 16, y - 11); K.lineTo(xe - dir * 16, y + 11); K.closePath(); K.fillStyle = col; K.fill();
  }
  function moAvatar(K, x, y, r, who) {
    circle(K, x, y, r, who ? C.red : C.ink);
    K.save(); K.beginPath(); K.arc(x, y, r - 2, 0, TAU); K.clip(); person(K, x, y + r * 0.75, r / 48, '#FFFFFF'); K.restore();
  }
  const GLY = '#%?&*@!/~<>';
  function moScramble(str, t, seed, amt) {
    const k = Math.floor(t * 7);
    return [...str].map((c, i) => c === ' ' ? ' ' : hash(seed + i * 7.31 + k * 1.77) < amt ? GLY[Math.floor(hash(seed * 3.3 + i * 1.9 + k * 11.1) * GLY.length)] : c).join('');
  }

  // race progress: same overall pace, the two runners leapfrog and tie exactly at the finish
  const base = u => 0.78 * u + 0.22 * E.inOutCubic(u);
  function prog(t, who) {
    const u = clamp((t - RUN0) / (RUN1 - RUN0));
    const lf = 0.045 * Math.sin(u * TAU * 1.5) * Math.sin(u * Math.PI);
    return clamp(base(u) + (who ? -lf : lf));
  }
  const HIT = [0, 1].map(who => NODES.map(([f]) => {
    for (let k = 0; k <= 800; k++) { const tt = RUN0 + (RUN1 - RUN0) * k / 800; if (prog(tt, who) >= f - 1e-4) return tt; }
    return RUN1;
  }));

  // ── calendar ──
  const WD = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  // time-lapse tear-off: OCT 12 (Mon) → NOV 12, one physical tear per sheet shown
  const OFF = [0, 2, 6, 12, 19, 25, 29, 31];
  const DATES = OFF.map(o => { const d = 12 + o; return { m: d <= 31 ? 'OCT' : 'NOV', d: d <= 31 ? d : d - 31, w: WD[o % 7] }; });
  const NT = OFF.length - 1;
  const kOf = t => NT * E.inOutCubic(clamp((t - FLIP0) / (FLIP1 - FLIP0)));
  const TEAR = [...Array(NT)].map((_, j) => {
    for (let s = 0; s <= 1200; s++) { const tt = FLIP0 + (FLIP1 - FLIP0) * s / 1200; if (kOf(tt) >= j + 1) return tt; }
    return FLIP1;
  });
  const PG = { x: -CAL.w / 2, y: -CAL.h / 2 + 40, w: CAL.w, h: CAL.h - 40 };
  function moPage(K, j, o = {}) {
    const { x, y, w, h } = PG, D = DATES[j];
    fillRR(K, x, y, w, h, 16, '#FFFFFF'); strokeRR(K, x, y, w, h, 16, C.ink, 3);
    K.save(); rr(K, x, y, w, h, 16); K.clip(); K.fillStyle = C.red; K.fillRect(x, y, w, 86); K.restore();
    line(K, x, y + 86, x + w, y + 86, C.ink, 3, 'butt');
    text(K, D.m, 0, y + 62, { font: F.mono, weight: 700, size: 40, color: '#FFFFFF', ls: 10 });
    X([K], 0, y + 86 + 214, o.bump || 1, 0, () => text(K, String(D.d), 0, 0, { font: F.grot, weight: 700, size: 236, color: C.ink, ls: -10 }));
    text(K, D.w, 0, y + h - 30, { font: F.mono, weight: 700, size: 26, color: GREY, ls: 6 });
  }
  function moCalendar(T, K, t) {
    const k = kOf(t), cur = Math.min(NT, Math.floor(k)), f = cur < NT ? k - cur : 0;
    const land = clamp((t - FLIP1) / 0.3), bump = 1 + ring(t - FLIP1, 3, 8) * 0.1 * (t >= FLIP1 ? 1 : 0);
    // shadow + block thickness
    T.save(); T.shadowColor = 'rgba(0,0,0,0.45)'; T.shadowBlur = 44; T.shadowOffsetY = 26; fillRR(T, PG.x, PG.y, PG.w, PG.h + 14, 16, '#FFFFFF'); T.restore();
    fillRR(T, PG.x, PG.y, PG.w, PG.h + 14, 16, '#FFFFFF');
    for (let i = 3; i >= 1; i--) { fillRR(K, PG.x + i * 3, PG.y + i * 5, PG.w - i * 6, PG.h, 16, '#FFFFFF'); strokeRR(K, PG.x + i * 3, PG.y + i * 5, PG.w - i * 6, PG.h, 16, 'rgba(17,17,17,0.35)', 2); }
    // top sheet: starts to peel (bottom corner lifts) just before it tears
    const peel = E.inCubic(clamp((f - 0.55) / 0.45));
    if (peel > 0 && cur < NT) moPage(K, cur + 1);
    K.save(); K.translate(0, PG.y); K.rotate(-peel * 0.08); K.scale(1, 1 - 0.12 * peel); K.translate(0, -PG.y);
    moPage(K, cur, { bump: cur === NT ? bump : 1 });
    K.restore();
    // binder
    fillRR(K, -CAL.w / 2 - 12, -CAL.h / 2, CAL.w + 24, 58, 16, C.ink);
    for (const bx of [-110, 110]) { circle(K, bx, -CAL.h / 2 + 29, 13, '#FFFFFF'); fillRR(K, bx - 6, -CAL.h / 2 - 16, 12, 44, 6, '#D9D5CC'); strokeRR(K, bx - 6, -CAL.h / 2 - 16, 12, 44, 6, C.ink, 2.5); }
    // torn sheets tumble away (start exactly where the top sheet was)
    for (let j = 0; j < cur; j++) {
      const d = t - TEAR[j]; if (d < 0 || d > 0.3) continue;
      const side = j % 2 ? 1 : -1, vx = side * (900 + hash(j * 5.7) * 400), vy = -(1500 + hash(j * 7.7) * 500);
      const x = vx * d, y = vy * d + 2600 * d * d, rot = side * (220 + hash(j * 9.1) * 200) * d, s = 1 - 1.4 * d;
      const fl = Math.cos(d * 16 + j);
      moA([T, K], 1 - clamp((d - 0.16) / 0.14), () => X([T, K], x, y, s, rot, () => {
        T.save(); T.translate(0, PG.y); T.scale(1, Math.max(0.15, Math.abs(fl))); T.translate(0, -PG.y); fillRR(T, PG.x + 12, PG.y + 18, PG.w, PG.h, 16, C.k30); T.restore();
        K.save(); K.translate(0, PG.y); K.scale(1, Math.max(0.15, Math.abs(fl))); K.translate(0, -PG.y); moPage(K, j); K.restore();
      }));
    }
    // landing: ring + burst on NOV 12
    if (land > 0 && land < 1) {
      shock(K, 0, 40, t - FLIP1, { r: 330, color: C.red, lw: 6, dur: 0.32 });
      burst(K, 0, 40, t - FLIP1, { n: 14, r0: 250, r1: 380, color: C.red, lw: 7, dur: 0.3 });
    }
  }

  // ── a lane card (local 0..CW × 0..CH) ──
  function moCard(T, K, t, who) {
    const fog = who ? 0 : clamp((t - MAP0) / 0.35);
    T.save(); T.shadowColor = 'rgba(0,0,0,0.42)'; T.shadowBlur = 42; T.shadowOffsetY = 24; fillRR(T, 0, 0, CW, CH, 28, '#FFFFFF'); T.restore();
    fillRR(T, 0, 0, CW, CH, 28, '#FFFFFF');
    if (fog > 0) moFog(T, t, fog);
    // white card on K (A's body thins out so the fog prints through)
    K.save(); rr(K, 0, 0, CW, CH, 28); K.clip();
    K.fillStyle = '#FFFFFF'; K.fillRect(0, 0, CW, 98);
    K.globalAlpha *= 1 - 0.8 * fog; K.fillRect(0, 98, CW, CH - 98);
    K.restore();
    strokeRR(K, 0, 0, CW, CH, 28, who ? C.ink : 'rgba(17,17,17,0.22)', who ? 3.5 : 2.5);

    // header: avatar · name · learning-mode pill
    moAvatar(K, 52, 50, 30, who);
    text(K, who ? 'you + learn-mode' : 'vibe coding', 98, 62, Object.assign({ color: C.ink, align: 'left', ls: -0.5 }, GROT(32)));
    const pl = who ? 'learning mode on' : 'learning mode off', pf = MONO(22), pw = measure(K, pl, pf) + 34;
    const dd = t - DIFF, shake = who ? 0 : Math.sin(dd * 40) * 7 * Math.exp(-Math.max(0, dd) * 7) * (dd > 0 ? 1 : 0);
    const ps = who ? 1 + ring(dd, 3, 7) * 0.16 * (dd > 0 ? 1 : 0) : 1;
    X([K], PILL_X + pw / 2 + shake, 51, ps, 0, () => {
      fillRR(K, -pw / 2, -21, pw, 42, 21, who ? C.red : '#F1EFEA');
      if (!who) strokeRR(K, -pw / 2, -21, pw, 42, 21, '#DAD6CD', 2);
      text(K, pl, 0, 8, Object.assign({ color: who ? '#FFFFFF' : GREY }, pf));
    });
    if (who && dd > 0 && dd < 0.6) {                       // the one difference: ring + burst
      const q = clamp(dd / 0.45), g = E.outCubic(q) * 22;
      moA([K], 1 - E.inCubic(q), () => strokeRR(K, PILL_X - g, 30 - g, pw + g * 2, 42 + g * 2, 21 + g, C.red, 4));
    }
    if (!who && dd > 0.05) { const q = E.outCubic(clamp((dd - 0.05) / 0.16)); moA([K], 1 - clamp((t - SWAP) / 0.1), () => line(K, PILL_X + 10, 51, PILL_X + 10 + (pw - 20) * q, 51, GREY, 3)); }
    line(K, 24, 98, CW - 24, 98, 'rgba(17,17,17,0.1)', 2, 'butt');

    if (t < SWAP) moRace(T, K, t, who); else moMapBody(T, K, t, who);
  }

  function moFog(T, t, a) {
    T.save(); rr(T, 8, 100, CW - 16, CH - 108, 22); T.clip();
    for (let i = 0; i < 6; i++) {
      const x = 90 + i * 160 + 50 * Math.sin(t * 1.4 + i * 1.7), y = 210 + 60 * Math.sin(t * 1.1 + i * 2.3), r = 210 + 30 * Math.sin(t * 2 + i);
      const g = T.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(0,0,0,${0.3 * a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      T.fillStyle = g; T.fillRect(x - r, y - r, r * 2, r * 2);
    }
    T.restore();
  }

  // race body: idea → sign in → notes → folders → ship
  function moRace(T, K, t, who) {
    const tp = E.outCubic(clamp((t - TRK - who * 0.05) / 0.32));
    if (tp <= 0) return;
    const fade = 1 - clamp((t - (SWAP - 0.08)) / 0.08);
    moA([K], fade, () => {
      line(K, TX0, TY, lerp(TX0, TX1, tp), TY, LIGHT, 12);
      const p = prog(t, who), xr = lerp(TX0, TX1, p);
      if (t > RUN0) line(K, TX0, TY, xr, TY, who ? C.red : C.ink, 12);
      // start
      circle(K, TX0, TY, 12, '#FFFFFF', who ? C.red : C.ink, 4);
      text(K, 'idea', TX0, TY - 40, Object.assign({ color: GREY, align: 'center' }, MONO(22)));
      NODES.forEach(([f, lb], i) => {
        const nx = lerp(TX0, TX1, f), ap = clamp((tp - f * 0.75) / 0.25); if (ap <= 0) return;
        const d = t - HIT[who][i], on = d >= 0, last = i === NODES.length - 1;
        moA([K], ap * (last ? 1 - clamp(d / 0.08) : 1), () => text(K, lb, nx, TY - 40, Object.assign({ color: on ? C.ink : GREY, align: 'center' }, MONO(22))));
        if (last && on) return;
        const s = on ? 1 + ring(d, 3, 8) * 0.35 : ap;
        circle(K, nx, TY, 17 * s, on ? (who ? C.red : C.ink) : '#FFFFFF', on ? null : '#CFCAC0', 4);
        if (on) { check(K, nx, TY + 1, 17, clamp(d / 0.1), '#FFFFFF', 4.5); shock(K, nx, TY, d, { r: 48, color: who ? C.red : C.ink, lw: 4, dur: 0.28 }); }
      });
      // shipped pill at the finish
      const dS = t - TIE;
      if (dS >= 0) {
        const q = pop(dS, 2.8, 0.45);
        X([K], TX1, TY, Math.max(0.01, q), 0, () => {
          fillRR(K, -104, -28, 208, 56, 28, who ? C.red : C.ink);
          text(K, 'shipped', -20, 10, Object.assign({ color: '#FFFFFF', align: 'center' }, GROT(28)));
          check(K, 66, 2, 26, clamp(dS / 0.14), '#FFFFFF', 5);
        });
      }
      // runner (rides the track, speed lines while moving)
      if (t > TRK + 0.15 && t < TIE + 0.04) {
        const mv = win(t, RUN0, RUN1 - 0.04, 0.1, 0.06);
        if (mv > 0) for (let i = 0; i < 3; i++) {
          const len = (34 + 30 * (0.5 + 0.5 * Math.sin(t * 31 + i * 2 + who))) * mv;
          line(K, xr - 40 - len, TY - 13 + i * 13, xr - 40, TY - 13 + i * 13, who ? 'rgba(255,59,31,0.55)' : 'rgba(17,17,17,0.35)', 5);
        }
        const bob = mv * Math.abs(Math.sin(t * 22 + who)) * -6;
        circle(K, xr, TY + bob, 33, '#FFFFFF');
        moAvatar(K, xr, TY + bob, 29, who);
      }
      // caption
      const cp = clamp((t - TRK - 0.1 - who * 0.06) / 0.2);
      moA([K], cp, () => text(K, who ? '// you decide, AI writes' : '// AI writes, you accept', TX0 - 30, CH - 34, Object.assign({ color: who ? C.ink : GREY, align: 'left' }, MONO(24, 500))));
    });
  }

  // a month later: the same app map. A: fogged, scrambled, "?" · B: crisp, ✓ per box, you explain it
  function moMapBody(T, K, t, who) {
    const cy = BY0 + BH / 2;
    BOX.forEach(([bx, bw, lb], i) => {
      const p = pop(t - MAP0 - i * 0.07, 2.6, 0.5); if (p <= 0.001) return;
      X([K], bx + bw / 2, cy, Math.max(0.01, p), 0, () => {
        if (who) {
          fillRR(K, -bw / 2, -BH / 2, bw, BH, 18, i === 1 ? '#FFF1EE' : '#FFFFFF'); strokeRR(K, -bw / 2, -BH / 2, bw, BH, 18, C.ink, 3.5);
          text(K, lb, 0, 11, Object.assign({ color: C.ink, align: 'center' }, GROT(32)));
        } else {
          K.save(); K.globalAlpha *= 0.7; fillRR(K, -bw / 2, -BH / 2, bw, BH, 18, '#FFFFFF'); K.restore();
          K.save(); K.setLineDash([10, 8]); strokeRR(K, -bw / 2, -BH / 2, bw, BH, 18, '#ABA69C', 3); K.restore();
          const amt = 0.35 + 0.35 * clamp((t - MAP0 - 0.15) / 0.4);
          X([K], 0, 0, 1, Math.sin(t * 3 + i) * 1.5, () => text(K, moScramble(lb, t, 17 + i * 5, amt), 0, 10, Object.assign({ color: GREY, align: 'center' }, MONO(28))));
        }
      });
      // B: ✓ as you explain each piece · A: "?"
      if (who) {
        const d = t - CHK[i]; if (d < 0) return;
        const q = pop(d, 3, 0.45), x = bx + bw - 8, y = BY0 + 6;
        X([K], x, y, Math.max(0.01, q), 0, () => { circle(K, 0, 0, 20, C.red, '#FFFFFF', 4); check(K, 0, 1, 20, clamp(d / 0.12), '#FFFFFF', 4.5); });
        shock(K, x, y, d, { r: 60, color: C.red, lw: 4, dur: 0.3 });
      } else {
        const d = t - QS[i]; if (d < 0) return;
        const q = pop(d, 2.8, 0.4), x = bx + bw / 2 + [-40, 60, 30][i], y = BY0 - 6;
        X([K], x, y, Math.max(0.01, q), -12 + 10 * Math.sin(t * 4 + i * 2), () => {
          circle(K, 0, 0, 26, '#FFFFFF', C.ink, 3.5);
          text(K, '?', 0, 13, Object.assign({ color: C.ink, align: 'center' }, GROT(38)));
        });
      }
    });
    // arrows: notes ← folder links → folders
    const ap = clamp((t - MAP0 - 0.24) / 0.2);
    if (who) { moArrow(K, BOX[1][0] - 8, cy, BOX[0][0] + BOX[0][1] + 6, C.ink, 4, ap); moArrow(K, BOX[1][0] + BOX[1][1] + 8, cy, BOX[2][0] - 6, C.ink, 4, ap); }
    else if (ap > 0) {
      K.save(); K.setLineDash([6, 9]); K.globalAlpha *= ap;
      line(K, BOX[1][0] - 8, cy + 6 * Math.sin(t * 5), BOX[0][0] + BOX[0][1] + 8, cy - 8, '#ABA69C', 4);
      line(K, BOX[1][0] + BOX[1][1] + 8, cy - 6, BOX[2][0] - 8, cy + 10 * Math.sin(t * 4), '#ABA69C', 4);
      K.restore();
    }
    // speech bubble (typed)
    const bp = clamp((t - TYPE0 + 0.1) / 0.14);
    if (bp > 0) moA([K], bp, () => {
      const bx = 36, by = 258, bw = CW - 72, bh = 78, k = clamp((t - TYPE0) / (TYPE1 - TYPE0));
      if (who) {
        fillRR(K, bx, by, bw, bh, 22, C.ink);
        K.beginPath(); K.moveTo(bx + 40, by + 2); K.lineTo(bx + 52, by - 16); K.lineTo(bx + 72, by + 2); K.closePath(); K.fillStyle = C.ink; K.fill();
        const pre = 'you:', pf = MONO(24), pfw = measure(K, pre, pf);
        text(K, pre, bx + 26, by + 48, Object.assign({ color: C.red, align: 'left' }, pf));
        const full = 'Deleting a folder removes its links, not the notes.';
        let fs = 28; const avail = bw - 26 - pfw - 16 - 24; while (fs > 22 && measure(K, full, GROT(fs, 500)) > avail) fs -= 1;
        const str = full.slice(0, Math.round(full.length * k));
        const tx = bx + 26 + pfw + 16, tw = text(K, str, tx, by + 49, Object.assign({ color: '#FFFFFF', align: 'left' }, GROT(fs, 500)));
        if (k < 1) { const cw = measure(K, str, GROT(fs, 500)); fillRR(K, tx + cw + 4, by + 24, 3, 32, 1, C.red); }
      } else {
        K.save(); K.globalAlpha *= 0.88; fillRR(K, bx, by, bw, bh, 22, '#FFFFFF'); K.restore();
        K.save(); K.setLineDash([10, 8]); strokeRR(K, bx, by, bw, bh, 22, '#8F8A80', 3); K.restore();
        K.beginPath(); K.moveTo(bx + 40, by); K.lineTo(bx + 52, by - 16); K.lineTo(bx + 72, by); K.closePath(); K.fillStyle = '#FFFFFF'; K.fill();
        const full = 'wait… what does this do?', str = full.slice(0, Math.round(full.length * clamp(k * 1.6)));
        text(K, str, bx + 30, by + 53, { font: F.serif, italic: true, weight: 400, size: 42, color: '#5E5A53', align: 'left' });
      }
    });
    // header meter: understanding
    const mp = clamp((t - MAP0) / 0.2);
    if (mp > 0) moA([K], mp, () => {
      const mx = 690, mw = 128;
      text(K, 'understanding', mx, 44, Object.assign({ color: GREY, align: 'left' }, MONO(22, 500)));
      fillRR(K, mx, 58, mw, 16, 8, LIGHT);
      if (who) {
        const v = lerp(0.75, 1, E.outBack(clamp((t - UND + 0.06) / 0.26)));
        fillRR(K, mx, 58, mw * Math.min(1, v), 16, 8, C.red);
        const hot = t >= UND, s = 1 + ring(t - UND - 0.1, 3, 8) * 0.22 * (hot ? 1 : 0);
        X([K], CW - 28, 78, s, 0, () => text(K, Math.round(100 * Math.min(1, v)) + '%', 0, 0, Object.assign({ color: hot ? C.red : C.ink, align: 'right' }, GROT(36))));
        burst(K, CW - 70, 62, t - UND - 0.12, { n: 12, r0: 60, r1: 120, color: C.red, lw: 5, dur: 0.32 });
      } else {
        const v = 0.22 + 0.06 * Math.sin(t * 4.5) - 0.08 * clamp((t - QS[0]) / 0.6);
        fillRR(K, mx, 58, mw * v, 16, 8, '#ABA69C');
        X([K], CW - 44, 76, 1, 8 * Math.sin(t * 5), () => text(K, '?', 0, 0, Object.assign({ color: GREY, align: 'center' }, GROT(40))));
      }
    });
  }

  // ── card poses ──
  function poseA(t) {
    const p = inAt(t, IN[0], 2.2, 0.62); if (p <= 0.001) return null;
    let x = CX - (1 - p) * 1150, y = AY + CH / 2, s = 1, r = -(1 - p) * 10, a = 1;
    const rc = win(t, REC, BACK, 0.26, 0.24);
    y -= 18 * rc; s -= 0.1 * rc; a -= 0.74 * rc;
    const d = t - DROP;
    if (d > 0) { y += 2000 * d * d + 120 * d; x -= 260 * d; r -= 16 * E.inCubic(clamp(d / 0.4)); s *= 1 - 0.12 * clamp(d / 0.3); a *= 1 - clamp((d - 0.1) / 0.2); }
    if (a <= 0.01) return null;
    return { x, y, s, r, a };
  }
  function poseB(t) {
    const p = inAt(t, IN[1], 2.2, 0.62); if (p <= 0.001) return null;
    let x = CX + (1 - p) * 1150, y = BY + CH / 2, s = 1, r = (1 - p) * 10, a = 1;
    const rc = win(t, REC, BACK, 0.26, 0.24);
    y += 18 * rc; s -= 0.1 * rc; a -= 0.74 * rc;
    const f = E.inOutCubic(clamp((t - FOC) / 0.32));
    y = lerp(y, 720, f); s *= 1 + 0.04 * f;
    const u = clamp((t - COLL0) / (COLL1 - COLL0));
    if (u > 0) { const e = E.inOutCubic(u); x = lerp(x, TCC.x, e); y = lerp(y, TCC.y, e); s *= lerp(1, 0.08, E.inCubic(u)); a *= 1 - clamp((u - 0.6) / 0.4); r = -7 * Math.sin(Math.PI * u); }
    if (u >= 1 || a <= 0.01) return null;
    return { x, y, s, r, a };
  }
  function moDrawCard(T, K, t, who, q) {
    moA([T, K], q.a, () => X([T, K], q.x, q.y, q.s, q.r, () => X([T, K], -CW / 2, -CH / 2, 1, 0, () => moCard(T, K, t, who))));
  }

  // learning card tucks down-left while the lanes play (frees the presenter's pointing arm), back at TC before the lane lands in it
  function cardPose(t) {
    const w = win(t, S0 + 0.2, COLL0 - 0.16, 0.35, 0.3);
    return { x: lerp(TC.x, 40, w), y: lerp(TC.y, 1436, w), s: lerp(TC.s, 0.8, w) };
  }
  // ── the presenter's aim ──
  const SHX = PRESENTER_DOCK.x - 226 * PRESENTER_DOCK.s, SHY = PRESENTER_DOCK.y - 264 * PRESENTER_DOCK.s;
  const AIM = Track({ x: TCC.x, y: TCC.y })
    .key(S0 + 0.1, { x: 600, y: 760 })
    .key(S0 + 0.42, { x: 60 + TX0 + 40, y: BY + TY })
    .key(TIE + 0.12, { x: 60 + TX1, y: SEAM })
    .key(DIFF - 0.1, { x: 60 + TX1, y: SEAM })
    .key(DIFF + 0.08, { x: 60 + PILL_X + 120, y: BY + 51 })
    .key(REC, { x: 60 + PILL_X + 120, y: BY + 51 })
    .key(CAL_IN + 0.2, { x: CAL.x, y: CAL.y - 20 })
    .key(CAL_OUT, { x: CAL.x, y: CAL.y - 20 })
    .key(QS[0], { x: 60 + 280, y: AY + 200 })
    .key(CHK[0] - 0.1, { x: 60 + 280, y: AY + 220 })
    .key(CHK[0] + 0.06, { x: 60 + 330, y: BY + 180 })
    .key(UND, { x: 60 + 500, y: BY + 170 })
    .key(FOC + 0.3, { x: 480, y: 760 })
    .key(COLL0, { x: 480, y: 760 })
    .key(COLL1, { x: TCC.x, y: TCC.y });
  function moAim(t) {
    let { x, y } = AIM.at(t);
    const w = win(t, RUN0 - 0.14, TIE - 0.02, 0.14, 0.14);
    if (w > 0) { x = lerp(x, 60 + lerp(TX0, TX1, prog(t, 1)), w); y = lerp(y, BY + TY, w); }
    return { x, y };
  }

  SC.month = {
    label: '// 07 — a month', bg: 'light',
    cam(t) {
      if (t < S0 + 0.15 || t >= HO) return { x: 0, y: 0, z: 1, r: 0 };
      const a = win(t, S0 + 0.15, REC, 0.6, 0.3), pr = prog(t, 1);
      let z = 1 + 0.03 * a, x = lerp(16, -18, pr) * a, y = 0, r = 0;
      z += 0.02 * Math.max(0, ring(t - TIE, 2.4, 6)) * (t > TIE ? 1 : 0);
      const d = win(t, DIFF - 0.06, REC, 0.24, 0.26);
      z += 0.05 * d; x += 46 * d; y += 34 * d;
      const c = win(t, CAL_IN, CAL_OUT, 0.34, 0.24);
      z += 0.06 * c; y += 30 * c; r += 0.008 * c * Math.sin((t - CAL_IN) * 5);
      const m = win(t, BACK, FOC, 0.4, 0.3);
      z += 0.025 * m; y += 14 * m;
      const f = win(t, FOC, COLL0 - 0.02, 0.3, 0.2);
      z += 0.035 * f; y += 30 * f;
      return { x, y, z, r };
    },
    draw(T, K, t) {
      // learning card (through-object): tag rings on "difference", bumps when the lane lands back in it
      const bumpD = t - COLL1, bs = bumpD > 0 && bumpD < 0.08 ? 1 + 0.045 * Math.sin(Math.PI * bumpD / 0.08) : 1;
      const cp = cardPose(t);
      if (bs === 1) learnCard(T, K, cp.x, cp.y, cp.s, { t });
      else X([T, K], TCC.x, TCC.y, bs, 0, () => learnCard(T, K, -TC_W / 2, -TC_H / 2, TC.s, { t }));
      if (t < S0 + 0.15 || t >= HO) return;
      if (bumpD > 0 && bumpD < 0.08) { const q = bumpD / 0.08, g = E.outCubic(q) * 22; moA([K], 1 - q, () => strokeRR(K, TC.x - g, TC.y - g, TC_W + g * 2, TC_H + g * 2, 20 + g, C.red, 4)); }
      const dd = t - DIFF;
      if (dd > 0 && dd < 0.55) {
        const hw = measure(K, CARD_HEAD, MONO(20)), tw = measure(K, CARD_TAG, { font: F.serif, italic: true, weight: 400, size: 26 });
        const q = clamp(dd / 0.5), g = E.outCubic(q) * 8;
        moA([K], q < 0.7 ? 1 : 1 - (q - 0.7) / 0.3, () => X([K], cp.x, cp.y, cp.s, 0, () => strokeRR(K, 24 + hw + 6 - g, 12 - g, tw + 14 + g * 2, 42 + g * 2, 12 + g, C.red, 3.5)));
      }
      // glows behind the hero lane
      const qb = poseB(t);
      if (qb) {
        moGlow(T, qb.x, qb.y, 620, 0.3 * Math.exp(-Math.max(0, t - UND) * 2.2) * (t >= UND ? 1 : 0) * qb.a);
        moGlow(T, qb.x, qb.y, 640, 0.2 * win(t, FOC, COLL0, 0.25, 0.15) * qb.a);
        moGlow(T, qb.x - 120, qb.y - 140, 420, 0.22 * Math.exp(-Math.max(0, t - DIFF) * 3) * (t >= DIFF ? 1 : 0) * qb.a);
      }
      // lane cards (A under B so it sinks behind)
      const qa = poseA(t);
      if (qa) moDrawCard(T, K, t, 0, qa);
      if (qb) moDrawCard(T, K, t, 1, qb);
      // finish line + "=" badge (race)
      const fl = clamp((t - TRK - 0.12) / 0.3) * (1 - win(t, REC - 0.05, 99, 0.12, 0));
      if (fl > 0 && t < SWAP) {
        const x = 60 + TX1, y0 = AY + TY + 34, y1 = BY + TY - 72;
        K.save(); K.setLineDash([12, 10]); K.lineDashOffset = -t * 40; line(K, x, y0, x, lerp(y0, y1, E.outCubic(clamp(fl * 1.4))), C.red, 4, 'butt'); K.restore();
        const dT = t - TIE;
        if (dT > 0) {
          const q = pop(dT, 2.8, 0.42);
          moA([K], fl, () => X([K], x, SEAM, Math.max(0.01, q), 0, () => {
            circle(K, 0, 0, 38, C.ink, '#FFFFFF', 5);
            fillRR(K, -16, -11, 32, 7, 3, '#FFFFFF'); fillRR(K, -16, 4, 32, 7, 3, '#FFFFFF');
          }));
          burst(K, x, SEAM, dT, { n: 14, r0: 54, r1: 140, color: C.red, lw: 6, dur: 0.34 });
          moGlow(T, x, SEAM, 260, 0.35 * Math.exp(-dT * 4));
        }
      }
      // calendar
      if (t >= CAL_IN && t < CAL_OUT + 0.24) {
        const p = inAt(t, CAL_IN, 2.3, 0.55), o = clamp((t - CAL_OUT) / 0.22), oe = E.inOutCubic(o);
        const land = ring(t - CAL_IN - 0.16, 3.2, 8) * 0.04 * (t > CAL_IN + 0.16 ? 1 : 0);
        let x = CAL.x, y = lerp(CAL.y - 1100, CAL.y, p), r = lerp(-18, -2.5, Math.min(1.1, p)), s = 1 + land;
        x = lerp(x, CX, oe); y = lerp(y, SEAM, oe); s *= lerp(1, 0.1, E.inCubic(o)); r = lerp(r, 0, oe);
        moA([T, K], 1 - clamp((o - 0.7) / 0.3), () => X([T, K], x, y, s, r, () => moCalendar(T, K, t)));
      }
      // "+1 month" seam pill
      const sp = t - CAL_OUT - 0.16;
      if (sp > 0) {
        const q = pop(sp, 2.8, 0.45), a = 1 - clamp((t - DROP) / 0.16);
        moA([K], a, () => X([K], CX, SEAM, Math.max(0.01, q), 0, () => {
          fillRR(K, -104, -25, 208, 50, 25, C.red); strokeRR(K, -104, -25, 208, 50, 25, '#FFFFFF', 3);
          // tiny calendar glyph
          fillRR(K, -82, -13, 30, 28, 5, '#FFFFFF'); fillRR(K, -82, -13, 30, 9, 3, C.ink);
          text(K, '+1 month', 18, 9, Object.assign({ color: '#FFFFFF', align: 'center' }, MONO(24)));
        }));
      }
    },
    guy(t) {
      const d = PRESENTER_DOCK, st = { x: d.x, y: d.y, s: d.s, armL: 'point', armLp: 1 - E.inOutCubic(clamp((t - COLL0 - 0.04) / 0.2)) };
      const { x: tx, y: ty } = moAim(t);
      st.pointAng = clamp(Math.atan2(ty - SHY, SHX - tx) / D2R, -98, -58);
      const lx = clamp((tx - 842) / 520, -1, 1) * 0.75, ly = clamp((ty - 1500) / 650, -1, 1) * 0.85;
      const R = arms(t, [[TIE - 0.02, tThe + 0.12, 'R', 'thumb'],
        [tYoull - 0.02, CHK[0] - 0.04, 'R', 'hold'],
        [UND - 0.1, S1 + 1, 'R', 'thumb']]);
      Object.assign(st, { armR: R.armR, armRp: R.armRp });
      Object.assign(st, expr(t, [
        [S0, TIE - 0.06, { smile: 0.35, brow: 0.3 }],
        [TIE - 0.06, tThe + 0.08, { smile: 0.85, brow: 0.55 }],
        [tThe + 0.08, REC, { browTilt: 0.75, smile: 0.2, brow: 0.15 }],
        [REC, CAL_OUT, { brow: 0.9, shock: 0.35 }],
        [BACK, CHK[0] - 0.04, { smile: -0.35, browTilt: 0.8, brow: 0.25, sweat: 0.2 }],
        [CHK[0] - 0.04, FOC, { smile: 0.85, brow: 0.6 }],
        [FOC, S1, { smile: 0.7, brow: 0.3 }],
        [tOwn - 0.02, tOwn + 0.16, { wink: 1 }],
      ]));
      st.lookX = lx; st.lookY = ly;
      st.headTurn = lx * 0.22;
      st.headTilt = -5 * win(t, tThe + 0.08, REC, 0.12, 0.2) + 5 * win(t, BACK, CHK[0] - 0.04, 0.12, 0.2) - 3 * win(t, UND, FOC + 0.3, 0.1, 0.2);
      return st;
    },
  };
})();
