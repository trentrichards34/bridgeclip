// ═════════════ 05 · CTA  [wi(144)−0.08 ≈ 42.04 → 45.9] · classic look · video B "plug it in" ═════════════
// NOTE: reference code from a real reel. Word indices (wi(n)) refer to that reel's script; re-cue on your own words.json.
// Through-object left in: powerStrip() (kit), via BB. KEYWORD replaces the original hard-coded comment word.
// assets not included: none (avatars are faceless).
// "If you want to try all four,": the fully lit strip (4/4) rises to centre stage; a name tag clips onto each of the four cables
//   (logo + plug name), and on "all four" a surge runs every socket.
// "comment KEYWORD": a comment sheet rises; KEYWORD is typed in an outlined chip, posted → a solid glowing red pill; more KEYWORD
//   pills (from faceless avatars) stack under it. The strip glides back to the dock with all four cables flowing.
// "and I'll send you the links directly.": a DM bubble springs out of the presenter with the four real repo links; the presenter winks + thumbs-up.
// Uses BB (shared helpers, defined in plugins_crew.js). File-local names are prefixed bb.

SC.cta = (() => {
  // KEYWORD = REEL.cta.keyword (reel.json)
  const KEYWORD = (typeof REEL !== 'undefined' && REEL.cta && REEL.cta.keyword) || 'REEL';
  const S0 = wi(144) - 0.08, S1 = 45.9;                 // 42.04 → 45.9 (DUR; timeline.js loads after the scenes)
  const T_TAG = [0, 1, 2, 3].map(i => wi(146) + 0.02 + i * 0.12);
  const T_ALL = wi(149), T_FOUR = wi(150);
  const T_FOLD = wi(151) - 0.2, T_SHEET = wi(151) - 0.16;
  const T_TYPE = wi(151) + 0.1, CPS = 17, T_SEND = wi(152) + 0.06;
  const T_REPLY = [0, 1].map(k => T_SEND + 0.2 + k * 0.13);
  const T_DM = wi(153) + 0.02, T_ROW = [0, 1, 2, 3].map(i => wi(155) - 0.06 + i * 0.12), T_DIRECT = wi(159), T_THUMB = wi(159) - 0.04;
  const G = '#8a8780';
  kick(T_SEND + 0.02, 0.35, 0.3);

  // ── strip: dock → centre stage (names) → back to the dock ──
  const STAGE = { x: 60, y: 1100, s: 1.4 };
  function stripG(t) {
    const up = pop(t - (S0 + 0.02), 1.6, 0.64), down = pop(t - T_FOLD, 1.7, 0.72);
    return BB.mixG(BB.DOCK, STAGE, clamp(up, 0, 1.1) * (1 - down));
  }
  const REPOS = [
    { owner: 'owner', repo: 'database-plugin' },
    { owner: 'owner', repo: 'deploy-plugin' },
    { owner: 'owner', repo: 'agent-crew' },
    { owner: 'owner', repo: 'browser-tools-mcp' },
  ];
  const TAG_Y = [-120, -190, -260, -330];               // strip-space heights of the four cable tags (a staircase)

  // name tag clipped onto cable i (strip space)
  function tag(T, K, t, g, i) {
    const d = t - T_TAG[i], fold = E.inBack(P(t, T_FOLD + (3 - i) * 0.03, 0.22));
    if (d < 0 || fold >= 1) return;
    const Q = BB.cabCtl(i, socketX(i), BB.SEAT - 110);
    let u = 0; for (let k = 0; k <= 120; k++) { const [, y] = BB.bez(Q, k / 120); if (y <= TAG_Y[i]) { u = k / 120; break; } }
    const [cx, cy] = BB.bez(Q, u);
    const a = pop(d, 2.8, 0.5) * (1 - fold), sw = Math.sin((t - T_TAG[i]) * 4 + i) * 2.5;
    const f = { font: F.mono, weight: 700, size: 17 }, name = PLUG_NAMES[i], tw = measure(K, name, f) + 64, th = 40;
    const surge = Math.max(0, 1 - Math.abs(t - (T_ALL + 0.05 + i * 0.07)) / 0.16) + Math.max(0, 1 - Math.abs(t - (T_FOUR + 0.1)) / 0.2) * 0.8;
    // clip ring on the cable
    X([K], cx, cy, a, 0, () => { circle(K, 0, 0, 10, C.ink); circle(K, 0, 0, 10, null, surge > 0.2 ? C.red : '#FFFFFF', 3); });
    X([T, K], cx - 16, cy, a, sw, () => {
      line(K, 0, 0, -12, 0, C.ink, 3, 'butt');
      const x0 = -12 - tw, y0 = -th / 2;
      if (surge > 0) BB.glow(T, x0 + tw / 2, 0, tw * 0.75, 50, 0.55 * clamp(surge));
      T.save(); T.shadowColor = 'rgba(0,0,0,0.35)'; T.shadowBlur = 14; T.shadowOffsetY = 6; fillRR(T, x0, y0, tw, th, 12, '#FFFFFF'); T.restore();
      fillRR(K, x0, y0, tw, th, 12, '#FFFFFF');
      strokeRR(K, x0, y0, tw, th, 12, surge > 0.3 ? C.red : 'rgba(17,17,17,0.2)', surge > 0.3 ? 3 : 2);
      BB.logoDisc(K, i, x0 + 22, 0, 13);
      text(K, name, x0 + 44, 6, Object.assign({ color: C.ink, align: 'left' }, f));
    });
  }

  // ── comment sheet: KEYWORD typed in an outlined chip → posted as a solid glowing red pill; faceless replies stack under it ──
  const SH = { x: 90, y: 438, w: 900 }, HEAD = 84, ROW = 80, NROW = 3, INP = 100, SHH = HEAD + NROW * ROW + INP;
  const CF = { font: F.grot, weight: 700, size: 30, ls: 3 }, PF = { font: F.grot, weight: 700, size: 27, ls: 3 };
  const ITEMS = [{ skel: [300, 190], t0: -1 }, { skel: [220, 330], t0: -1 }, { you: true, t0: T_SEND }, { t0: T_REPLY[0], bg: '#E4DFD5' }, { t0: T_REPLY[1], bg: '#F0DDD6' }];
  const YOU = 2;
  const listScroll = t => ITEMS.reduce((a, it, k) => a + (k >= NROW ? E.inOutCubic(P(t, it.t0, 0.24)) : 0), 0);
  function you(K, x, y, r) { circle(K, x, y, r, C.ink); person(K, x, y + r * 0.2, r / 52, '#F6F5F1'); }
  function keywordPill(K, x, y, lit) {           // left-aligned at x, centred on y
    const pw = measure(K, KEYWORD, PF) + 36, ph = 42;
    fillRR(K, x, y - ph / 2, pw, ph, ph / 2, lit ? C.red : '#FFFFFF');
    strokeRR(K, x, y - ph / 2, pw, ph, ph / 2, C.red, 3);
    text(K, KEYWORD, x + pw / 2, y + 10, Object.assign({ color: lit ? '#FFFFFF' : C.red, align: 'center' }, PF));
  }
  function sheet(T, K, t) {
    if (t < T_SHEET) return;
    const a = pop(t - T_SHEET, 2.0, 0.64), x = SH.x, w = SH.w, h = SHH;
    const y = SH.y + (1 - a) * 1300, sc = lerp(0.92, 1, clamp(a));
    const scr = listScroll(t);
    X([T, K], x + w / 2, y, sc, (1 - clamp(a)) * 4, () => {
      const lx = -w / 2;
      uiCard(T, K, lx, 0, w, h, { r: 30 });
      fillRR(K, -36, 14, 72, 7, 3.5, '#DAD7CF');
      text(K, 'Comments', 0, 62, { font: F.grot, weight: 700, size: 30, color: C.ink });
      line(K, lx, HEAD, lx + w, HEAD, HAIR, 2, 'butt');
      K.save(); K.beginPath(); K.rect(lx, HEAD + 1, w, NROW * ROW); K.clip();
      ITEMS.forEach((it, k) => {
        const age = t - it.t0;
        if (age < 0 || it.you) return;
        const ry = HEAD + (k - scr) * ROW;
        if (ry < HEAD - ROW || ry > HEAD + NROW * ROW) return;
        const op = it.t0 < 0 ? 1 : E.outCubic(clamp(age / 0.2)), dy = (1 - op) * 22;
        K.save(); K.globalAlpha *= op;
        if (it.skel) {
          circle(K, lx + 56, ry + ROW / 2 + dy, 25, '#E4DFD5');
          fillRR(K, lx + 100, ry + 20 + dy, 120, 14, 7, '#E6E3DC');
          fillRR(K, lx + 100, ry + 44 + dy, it.skel[0], 16, 8, '#DDD9D1');
          fillRR(K, lx + 110 + it.skel[0], ry + 44 + dy, it.skel[1] * 0.4, 16, 8, '#E6E3DC');
        } else {
          const fl = Math.max(0, 1 - age / 0.45);
          if (fl > 0) fillRR(K, lx + 12, ry + 4, w - 24, ROW - 8, 16, `rgba(255,59,31,${0.1 * fl})`);
          circle(K, lx + 56, ry + ROW / 2 + dy, 25, it.bg);
          fillRR(K, lx + 100, ry + 18 + dy, 110, 13, 6.5, '#E6E3DC');
          keywordPill(K, lx + 100, ry + 54 + dy, false);
        }
        K.restore();
      });
      K.restore();
      // input bar
      const iy = h - INP;
      line(K, lx, iy, lx + w, iy, HAIR, 2, 'butt');
      you(K, lx + 56, iy + 50, 25);
      const fx = lx + 100, fw = w - 250, fy = iy + 18, fh = 64;
      const typing = t >= T_TYPE && t < T_SEND;
      fillRR(K, fx, fy, fw, fh, 32, '#FFFFFF'); strokeRR(K, fx, fy, fw, fh, 32, typing ? C.ink : HAIR, 3);
      const typed = t < T_SEND ? typedStr(KEYWORD, t, T_TYPE, CPS) : '';
      if (!typed) text(K, 'Add a comment…', fx + 28, fy + 42, { font: F.grot, weight: 500, size: 28, color: '#b3b0a8', align: 'left' });
      else {
        const cw = measure(K, typed, CF) + 32, bump = 1 + 0.07 * Math.exp(-((t - T_TYPE) * CPS % 1) * 6);
        X([K], fx + 14 + cw / 2, fy + fh / 2, bump, 0, () => {
          strokeRR(K, -cw / 2, -23, cw, 46, 12, C.red, 3);
          text(K, typed, -cw / 2 + 16, 11, Object.assign({ color: C.red, align: 'left' }, CF));
        });
        caretAt(K, fx + 14 + cw + 6, fy + 45, 34, t, C.ink);
      }
      const full = typed.length === 6, press = win(t, T_SEND - 0.06, T_SEND + 0.04, 0.04, 0.12);
      X([K], lx + w - 76, fy + fh / 2, 1 - press * 0.15, 0, () => text(K, 'Post', 0, 10, { font: F.grot, weight: 700, size: 29, color: full || t >= T_SEND ? C.red : '#C9C5BC' }));
      // posted: the chip flies input → its row, fills solid red and glows
      if (t >= T_SEND) {
        const fp = pop(t - T_SEND, 2.6, 0.58), q = clamp(fp);
        const pw = measure(K, KEYWORD, PF) + 40, ph = 46;
        const ty = HEAD + (YOU - scr) * ROW + 30, tx = lx + 100;
        const px = lerp(fx + 14, tx, fp), py = lerp(fy + fh / 2 - 23, ty, fp) - Math.sin(Math.PI * q) * 50;
        const glow = clamp((t - T_SEND - 0.16) / 0.25) * (0.8 + 0.2 * Math.sin(t * 7));
        const rowY = HEAD + (YOU - scr) * ROW;
        if (q > 0.5 && rowY > HEAD - ROW) {
          K.save(); K.beginPath(); K.rect(lx, HEAD + 1, w, NROW * ROW); K.clip();
          you(K, lx + 56, rowY + ROW / 2 - 4, 25);
          text(K, 'you', lx + 100 + pw + 18, rowY + 50, { font: F.mono, weight: 500, size: 22, color: G, align: 'left' });
          K.restore();
        }
        K.save(); if (q > 0.9) { K.beginPath(); K.rect(lx, HEAD + 1, w, NROW * ROW + 200); K.clip(); }
        if (glow > 0) BB.kdots(K, px + pw / 2, py + ph / 2, pw * 0.85, 64, 0.6 * glow);
        X([K], px + pw / 2, py + ph / 2, lerp(1, 1.06, q), lerp(-4, 0, q), () => {
          K.save();
          if (glow > 0) { K.shadowColor = `rgba(255,59,31,${0.9 * glow})`; K.shadowBlur = 44 * glow; fillRR(K, -pw / 2, -ph / 2, pw, ph, ph / 2, C.red); K.shadowBlur = 16 * glow; }
          fillRR(K, -pw / 2, -ph / 2, pw, ph, ph / 2, `rgba(255,59,31,${clamp(fp * 1.6)})`);
          K.restore();
          strokeRR(K, -pw / 2, -ph / 2, pw, ph, ph / 2, C.red, 3);
          text(K, KEYWORD, 0, 10, Object.assign({ color: q > 0.45 ? '#FFFFFF' : C.red }, PF));
        });
        const sd = t - T_SEND - 0.2;
        if (sd > 0 && sd < 0.42) { const sp = sd / 0.42, e = E.outCubic(sp) * 16; K.save(); K.globalAlpha *= 1 - sp; strokeRR(K, px - e, py - e, pw + 2 * e, ph + 2 * e, ph / 2 + e, C.red, 4 * (1 - sp) + 1); K.restore(); }
        K.restore();
      }
    });
  }

  // ── DM bubble with the four repo links ──
  const DM = { x: 50, y: 868, w: 690 }, DHEAD = 116, DROW = 80, DH = DHEAD + 4 * DROW + 22;
  function arrow(K, x, y, col) { K.save(); K.translate(x, y); K.strokeStyle = col; K.lineWidth = 4; K.lineCap = 'round'; K.lineJoin = 'round'; K.beginPath(); K.moveTo(-9, 9); K.lineTo(9, -9); K.moveTo(-4, -9); K.lineTo(9, -9); K.lineTo(9, 4); K.stroke(); K.restore(); }
  function chain(K, x, y, s, col) { K.save(); K.translate(x, y); K.rotate(-45 * D2R); K.scale(s, s); strokeRR(K, -19, -8, 22, 16, 8, col, 4); strokeRR(K, -3, -8, 22, 16, 8, col, 4); K.restore(); }
  function dm(T, K, t) {
    if (t < T_DM) return;
    const a = pop(t - T_DM, 2.2, 0.58), q = clamp(a);
    const cx = DM.x + DM.w / 2, cy = DM.y + DH / 2, ox = 800, oy = 1500, fl = Math.sin(t * 2.3) * 3 * q;
    X([T, K], lerp(ox, cx, a), lerp(oy, cy, a) + fl, lerp(0.12, 1, a), lerp(10, 0, q), () => {
      const x = -DM.w / 2, y = -DH / 2, w = DM.w;
      T.save(); T.shadowColor = 'rgba(0,0,0,0.42)'; T.shadowBlur = 46; T.shadowOffsetY = 26; fillRR(T, x, y, w, DH, 34, '#FFFFFF'); T.restore();
      const tail = c => { c.beginPath(); c.moveTo(x + w - 70, y + DH - 4); c.quadraticCurveTo(x + w + 6, y + DH + 10, x + w + 30, y + DH + 40); c.quadraticCurveTo(x + w - 10, y + DH + 26, x + w - 130, y + DH - 4); c.closePath(); };
      tail(T); T.fillStyle = '#FFFFFF'; T.fill();
      tail(K); K.lineWidth = 6; K.strokeStyle = HAIR; K.lineJoin = 'round'; K.stroke();
      strokeRR(K, x, y, w, DH, 34, HAIR, 3);
      fillRR(K, x + 1.5, y + 1.5, w - 3, DH - 3, 32.5, '#FFFFFF'); tail(K); K.fillStyle = '#FFFFFF'; K.fill();
      const hp = clamp((t - T_DM - 0.1) / 0.14);
      K.save(); K.globalAlpha *= hp;
      circle(K, x + 42, y + 42, 7, C.red);
      text(K, 'new message', x + 60, y + 50, { font: F.mono, weight: 500, size: 22, color: G, align: 'left' });
      const mf = { font: F.grot, weight: 700, size: 38, ls: -1 }, msg = typedStr('here are all 4 links', t, T_DM + 0.12, 60);
      text(K, msg, x + 30, y + 96, Object.assign({ color: C.ink, align: 'left' }, mf));
      if (msg.length === 20) { const lp = pop(t - T_DM - 0.12 - 20 / 60, 3.2, 0.4); X([K], x + 30 + measure(K, msg, mf) + 30, y + 84, lp, 0, () => chain(K, 0, 0, 1.1, C.red)); }
      K.restore();
      for (let i = 0; i < 4; i++) {
        const tr = T_ROW[i];
        if (t < tr) continue;
        const rp = pop(t - tr, 3.0, 0.5), R = REPOS[i];
        const ry = y + DHEAD + i * DROW, rx = x + 22, rw = w - 44, rh = 68;
        K.save(); K.globalAlpha *= clamp((t - tr) / 0.08);
        X([K], rx + rw / 2, ry + rh / 2, lerp(0.7, 1, rp), 0, () => {
          const bx = -rw / 2;
          fillRR(K, bx, -rh / 2, rw, rh, 16, '#F3F1EC');
          const sw = P(t, T_DIRECT + i * 0.07, 0.4);
          const flash = Math.max(0, 1 - (t - tr) / 0.35) * 0.25 + (sw > 0 && sw < 1 ? Math.sin(Math.PI * sw) * 0.3 : 0);
          if (flash > 0) fillRR(K, bx, -rh / 2, rw, rh, 16, `rgba(255,59,31,${flash})`);
          BB.logoDisc(K, i, bx + 40, 0, 22);
          circle(K, bx + 40, 0, 22, null, 'rgba(17,17,17,0.12)', 2);
          const nf = { font: F.grot, weight: 700, size: 25, ls: -0.5 };
          text(K, R.owner + '/', bx + 76, -3, Object.assign({ color: '#6B6B6B', align: 'left' }, nf, { weight: 500 }));
          text(K, R.repo, bx + 76 + measure(K, R.owner + '/', Object.assign({}, nf, { weight: 500 })), -3, Object.assign({ color: C.ink, align: 'left' }, nf));
          text(K, 'github.com', bx + 76, 23, { font: F.mono, weight: 500, size: 18, color: G, align: 'left' });
          const nudge = Math.max(0, Math.sin((t - tr) * 5)) * 3 * Math.exp(-(t - tr) * 1.5);
          arrow(K, -bx - 30 + nudge, -nudge, C.red);
        });
        K.restore();
      }
      const dp = pop(t - T_DIRECT - 0.26, 3, 0.45);
      if (dp > 0) X([K], x + w - 36, y + 34, dp, 0, () => { circle(K, 0, 0, 20, C.red); iconCheck(K, 1, 1, 24, clamp((t - T_DIRECT - 0.28) / 0.2), '#FFFFFF'); });
    });
  }

  return {
    label: '// 05 — comment KEYWORD', bg: 'light',
    cam: t => ({ z: 1 + 0.02 * E.inOutCubic(P(t, S0 + 0.1, 3.6)) }),
    draw(T, K, t) {
      const g = stripG(t), p = BB.defP(t);
      BB.cables(K, g, p);
      // all four cables live
      const live = clamp((t - S0 - 0.1) / 0.3);
      BB.inStrip([T, K], g, () => [0, 1, 2, 3].forEach(i => BB.flow(K, i, t + i * 0.13, live)));
      BB.fadeTop(K);
      BB.body(T, K, t, g, p, () => {
        BB.plugFace(K, 2, socketX(2), BB.SEAT, 0, 1); BB.plugFace(K, 3, socketX(3), BB.SEAT, 0, 1);
        [0, 1].forEach(i => BB.plugFace(K, i, socketX(i), BB.SEAT, 0, clamp((t - T_TAG[i]) / 0.15)));
        // "all four": a surge runs the strip, each socket flashes in turn
        const d = t - T_ALL;
        if (d > 0 && d < 0.8) {
          const sx = lerp(-120, STRIP_W + 120, E.inOutCubic(clamp(d / 0.4)));
          K.save(); rr(K, 0, 0, STRIP_W, STRIP_H, 34); K.clip();
          const gr = K.createLinearGradient(sx - 90, 0, sx + 90, 0); gr.addColorStop(0, 'rgba(255,59,31,0)'); gr.addColorStop(0.5, `rgba(255,59,31,${0.35 * (1 - clamp((d - 0.4) / 0.35))})`); gr.addColorStop(1, 'rgba(255,59,31,0)');
          K.fillStyle = gr; K.fillRect(0, 0, STRIP_W, STRIP_H); K.restore();
          BB.glow(T, sx, STRIP_H / 2, 150, 110, 0.6 * (1 - clamp((d - 0.4) / 0.35)));
          [0, 1, 2, 3].forEach(k => { const lt = d - 0.05 - 0.07 * k; if (lt > 0) shock(K, socketX(k) + 30, BB.SY - 30, lt, { r: 36, color: C.red, lw: 3, dur: 0.32 }); });
          shock(K, 44, 44, d, { r: 80, color: C.red, lw: 4, dur: 0.5 });
        }
      });
      BB.inStrip([T, K], g, () => [0, 1, 2, 3].forEach(i => tag(T, K, t, g, i)));
      sheet(T, K, t);
      dm(T, K, t);
    },
    guy(t) {
      const th = PRESENTER_DOCK;
      const hop = -16 * Math.sin(TAU * 1.6 * (t - T_THUMB)) * Math.exp(-4 * (t - T_THUMB)) * (t > T_THUMB ? 1 : 0);
      const up = pop(t - T_THUMB + 0.05, 2.2, 0.6);
      return Object.assign({ x: th.x, y: th.y + hop - 56 * up, s: th.s + 0.05 * up },
        arms(t, [
          [S0 - 1, S0 + 0.1, 'LR', 'shrug'],                                                          // carried over from the blindfold drop
          [S0 + 0.24, T_FOLD - 0.02, 'L', 'point', { pointAng: -60 + BB.jab(t, [T_ALL, T_FOUR]) }],  // "try all four"
          [T_FOLD + 0.02, T_SEND - 0.06, 'L', 'point', { pointAng: -84 + BB.jab(t, [wi(152)]) }],    // the comment box
          [T_SEND - 0.04, T_DM + 0.02, 'R', 'fist'],                                                   // posted!
          [T_DM + 0.04, T_THUMB - 0.24, 'R', 'hold'],                                                  // here you go
          [T_THUMB, S1 + 1, 'R', 'thumb'],
        ]),
        expr(t, [
          [S0 - 1, S0 + 0.08, { smile: 1, brow: 0.6 }],
          [S0, T_FOLD, { brow: 0.55, smile: 0.7 }],
          [T_FOLD, T_SEND, { brow: 0.85, smile: 0.4 }],
          [T_SEND, T_DM, { smile: 0.95, brow: 0.6 }],
          [T_DM, T_THUMB, { smile: 0.65, brow: 0.3 }],
          [T_THUMB, S1 + 1, { smile: 0.95 }],
          [T_THUMB + 0.14, S1 + 1, { wink: 1 }],
        ]),
        {
          lookX: -0.35 * win(t, S0 - 1, S0 + 0.1) - 0.5 * win(t, S0 + 0.1, T_FOLD) - 0.45 * win(t, T_FOLD, T_DM) - 0.6 * win(t, T_DM, T_THUMB - 0.1),
          lookY: -0.4 * win(t, S0 - 1, S0 + 0.1) - 0.7 * win(t, S0 + 0.1, T_FOLD) - 0.75 * win(t, T_FOLD, T_DM) + 0.1 * win(t, T_DM, T_THUMB - 0.1),
          headTurn: -0.18 * win(t, S0 - 1, S0 + 0.1) - 0.22 * win(t, S0 + 0.1, T_THUMB - 0.1),
          headTilt: 5 * win(t, S0 - 1, S0 + 0.12) + 6 * win(t, T_THUMB, S1 + 1) - 3 * win(t, T_FOLD, T_SEND),
        });
    },
  };
})();
