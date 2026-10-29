// ═════════════ 08 · CTA  [owi(106)−0.1 ≈ 26.18 → 28.6 end] · classic orange look ═════════════
// NOTE: reference code from a real reel. Word indices (wi(n)) refer to that reel's script; re-cue on your own words.json.
// Through-object left in: learnCard() (kit). KEYWORD replaces the hard-coded comment word; the fly-in letter animation assumes a 5-letter word matching WORD in the card tag ('learn'), adapt if your keyword differs.
// assets not included: IMG.gh_readme (repo README screenshot; lookup no-ops when missing).
// "Comment KEYWORD, and I'll send you the link."
// Beats: hand-off (learning-mode card at TC + the presenter docked) → "Comment": a generic comment sheet springs up under the captions,
// the camera pushes in on its empty composer · "KEYWORD": the word "learn" in the card's "learning mode" tag gets selected (red),
// and its five letters lift out of the card, arc up and land one by one in the composer as L-E-A-R-N (the card recoils) ·
// "and": Post is pressed (the one kick), the chip flies into the thread as a glowing red KEYWORD pill, KEYWORD replies roll in ·
// "I'll send you": a DM from @creator springs out of the presenter's hand while the sheet steps back; "here's the link" types ·
// "link": the link card unfurls with the real repo screenshot (github.com/owner/learn-mode · LearnMode), shimmer, "delivered ✓",
// The presenter thumbs up + wink. Settled hold for the last 0.5 s. The presenter points the whole time (aim follows the focus point).
// File-local helpers are prefixed vc (all inside this IIFE).
(() => {
  // KEYWORD = REEL.cta.keyword (reel.json)
  const KEYWORD = (typeof REEL !== 'undefined' && REEL.cta && REEL.cta.keyword) || 'REEL';
  const S0 = owi(106) - 0.1, END = 28.6;                                   // 26.18 → 28.6
  const tLearn = owi(107), tAnd = owi(108), tIll = owi(109), tSend = owi(110), tLink = owi(113);
  const T_SHEET = S0 + 0.1;                                              // 26.28 sheet springs up
  const T_SEL = tLearn - 0.2;                                            // 26.45 "learn" selected in the card
  const T_FLY = [0, 1, 2, 3, 4].map(i => tLearn - 0.12 + i * 0.04);     // 26.53 … 26.69 letters lift off
  const FLY_D = 0.2;                                                     // land 26.73 … 26.89
  const T_POST = tAnd + 0.02;                                            // 26.94 posted
  const T_REP = [T_POST + 0.36];                            // replies roll in
  const T_DM = tIll;                                                     // 27.06 DM springs out of the presenter
  const T_MSG = tSend, MSG_CPS = 52;                              // "here's the link" types
  const T_CARD = tLink - 0.06;                                           // 27.54 link card unfurls
  const T_SENT = tLink + 0.26;                                           // 27.86 delivered ✓
  const T_THUMB = tLink + 0.24;
  const T_SETTLE = END - 0.5;                                            // 28.10 everything still
  kick(T_POST + 0.02, 0.4, 0.3);

  const G = '#8a8780', KEY = KEYWORD, WORD = 'learn';
  const CF = { font: F.grot, weight: 700, size: 32, ls: 3 }, PF = { font: F.grot, weight: 700, size: 28, ls: 3 };
  const TAGF = { font: F.serif, italic: true, weight: 400, size: 26 };
  let TAGX = null;                                                       // x of the "learning mode" tag inside the card
  const tagX = K => TAGX ?? (TAGX = 24 + measure(K, CARD_HEAD, { font: F.mono, weight: 700, size: 20 }) + 12);

  // ── the through-object: stays at TC; recoils as the letters leave it ──
  function cardTf(t) {
    const dt = t - T_FLY[0];
    const rec = dt > 0 ? 1 + 0.035 * Math.sin(TAU * 2.4 * dt) * Math.exp(-6 * dt) : 1;
    const tuck = lerp(1, 0.84, E.inOutCubic(P(t, T_DM - 0.04, 0.4)));     // steps back (anchored bottom-left) to give the DM the stage
    return { x: TC.x + TC_W / 2 * (1 - rec), y: TC.y + TC_H / 2 * (1 - rec) + TC_H * (1 - tuck), s: rec * tuck };
  }
  function letterSrc(K, t, i) {                                          // world centre of letter i of "learn" in the tag
    const c = cardTf(t), x0 = tagX(K), off = measure(K, WORD.slice(0, i), TAGF) + measure(K, WORD[i], TAGF) / 2;
    return { x: c.x + c.s * (x0 + off), y: c.y + c.s * (42 - 9), s: c.s };
  }
  function card(T, K, t) {
    const c = cardTf(t);
    learnCard(T, K, c.x, c.y, c.s, { t });
    // the selection on "learn" (red box, white letters), fades after posting
    const sel = E.outCubic(P(t, T_SEL, 0.1)), fade = 1 - P(t, T_POST, 0.3);
    if (sel <= 0 || fade <= 0) return;
    X([K], c.x, c.y, c.s, 0, () => {
      const x0 = tagX(K), wl = measure(K, WORD, TAGF);
      K.save(); K.globalAlpha *= fade;
      rr(K, x0 - 6, 42 - 26, (wl + 12) * sel, 36, 7); K.fillStyle = C.red; K.fill(); K.clip();
      text(K, WORD, x0, 42, Object.assign({ color: '#FFFFFF', align: 'left' }, TAGF));
      K.restore();
    });
  }

  // ── comment sheet (generic, no platform logo) ──
  const SH = { cx: 540, top: 336, w: 900 }, HEAD = 80, ROW = 90, NROW = 3, INP = 100, SHH = HEAD + NROW * ROW + INP;
  const ITEMS = [
    { u: 'dev.rina', ini: 'R', bg: '#E4DFD5', c: "can't read my own code anymore", t0: -1 },
    { u: 'tomas.codes', ini: 'T', bg: '#F0DDD6', c: KEYWORD, t0: -1 },
    { u: 'jo.ships', ini: 'J', bg: '#DCD8D0', c: 'need this so bad', t0: -1 },
    { you: true, t0: T_POST },
    { u: 'kai.builds', ini: 'K', bg: '#E4DFD5', c: KEYWORD, t0: T_REP[0] },
  ];
  const YOU = 3;
  const listScroll = t => ITEMS.reduce((a, it, k) => a + (k >= NROW ? E.inOutCubic(P(t, it.t0, 0.22)) : 0), 0);
  function sheetTf(t) {
    const a = pop(t - T_SHEET, 2.1, 0.62);
    const s = lerp(1.0, 0.88, E.inOutCubic(P(t, T_DM - 0.12, 0.32)));
    return { cx: SH.cx, top: SH.top + (1 - a) * 1350, s: s * lerp(0.92, 1, clamp(a)), r: (1 - clamp(a)) * 5, a };
  }
  const toWorld = (f, x, y) => { const r = f.r * D2R, c = Math.cos(r), s = Math.sin(r); return { x: f.cx + f.s * (x * c - y * s), y: f.top + f.s * (x * s + y * c) }; };
  // composer geometry (sheet-local)
  const LX = -SH.w / 2, IY = SHH - INP, FX = LX + 96, FY = IY + 18, FH = 64;
  const landed = t => T_FLY.filter(t0 => t >= t0 + FLY_D).length;
  const chipLetter = (K, j) => ({ x: FX + 14 + 16 + measure(K, KEY.slice(0, j), CF) + measure(K, KEY[j], { ...CF, ls: 0 }) / 2, y: FY + FH / 2 + 11 });
  function vcHeart(K, x, y, s, col) {
    K.save(); K.translate(x, y); K.scale(s, s); K.beginPath();
    K.moveTo(0, 6); K.bezierCurveTo(-14, -4, -10, -16, 0, -9); K.bezierCurveTo(10, -16, 14, -4, 0, 6);
    K.lineWidth = 2.6 / s; K.strokeStyle = col; K.lineJoin = 'round'; K.stroke(); K.restore();
  }
  function vcYou(K, x, y, r) { circle(K, x, y, r, C.ink); person(K, x, y + r * 0.2, r / 52, '#F6F5F1'); }
  function pillAt(K, t, scr) {                                           // the posted KEYWORD pill, sheet-local
    const fp = pop(t - T_POST, 2.6, 0.58), q = clamp(fp);
    const pw = measure(K, KEY, PF) + 40, ph = 44;
    const tx = LX + 96, ty = HEAD + (YOU - scr) * ROW + 42;
    const fx0 = FX + 14, fy0 = FY + FH / 2 - 22;
    return { x: lerp(fx0, tx, fp), y: lerp(fy0, ty, fp) - Math.sin(Math.PI * q) * 28, w: pw, h: ph, q, fp };
  }
  function sheet(T, K, t) {
    if (t < T_SHEET) return;
    const f = sheetTf(t), scr = listScroll(t), w = SH.w, h = SHH;
    const typing = t >= T_FLY[0] && t < T_POST, n = t < T_POST ? landed(t) : 0;
    X([T, K], f.cx, f.top, f.s, f.r, () => {
      uiCard(T, K, LX, 0, w, h, { r: 30 });
      fillRR(K, -36, 14, 72, 7, 3.5, '#DAD7CF');
      text(K, 'Comments', 0, 60, { font: F.grot, weight: 700, size: 30, color: C.ink });
      line(K, LX, HEAD, LX + w, HEAD, HAIR, 2, 'butt');
      K.save(); K.beginPath(); K.rect(LX, HEAD + 1, w, NROW * ROW); K.clip();
      ITEMS.forEach((it, k) => {
        const age = t - it.t0;
        if (age < 0) return;
        const ry = HEAD + (k - scr) * ROW;
        if (ry < HEAD - ROW || ry > HEAD + NROW * ROW) return;
        const op = it.t0 < 0 ? 1 : E.outCubic(clamp(age / 0.2)), dy = (1 - op) * 22;
        K.save(); K.globalAlpha *= op;
        const fl = it.t0 < 0 ? 0 : Math.max(0, 1 - age / 0.45);
        if (fl > 0 && !it.you) fillRR(K, LX + 12, ry + 4, w - 24, ROW - 8, 16, `rgba(255,59,31,${0.1 * fl})`);
        if (it.you) {
          vcYou(K, LX + 54, ry + ROW / 2 + dy, 26);
          text(K, 'you', LX + 96, ry + 32 + dy, { font: F.mono, weight: 500, size: 22, color: G, align: 'left' });
          text(K, '· just now', LX + 96 + 56, ry + 32 + dy, { font: F.mono, weight: 500, size: 22, color: '#B3AFA6', align: 'left' });
        } else {
          circle(K, LX + 54, ry + ROW / 2 + dy, 26, it.bg);
          text(K, it.ini, LX + 54, ry + ROW / 2 + 9 + dy, { font: F.grot, weight: 700, size: 24, color: '#4a4740' });
          text(K, it.u, LX + 96, ry + 32 + dy, { font: F.mono, weight: 500, size: 22, color: G, align: 'left' });
          const key = it.c === KEY;
          text(K, it.c, LX + 96, ry + 75 + dy, key ? Object.assign({ color: C.ink, align: 'left' }, PF) : { font: F.grot, weight: 500, size: 28, color: C.ink, align: 'left' });
          vcHeart(K, LX + w - 50, ry + ROW / 2 + dy, 1.3, '#A9A59C');
        }
        K.restore();
      });
      K.restore();
      // composer
      line(K, LX, IY, LX + w, IY, HAIR, 2, 'butt');
      vcYou(K, LX + 54, IY + 50, 26);
      const fw = w - 250, focus = clamp((t - T_SHEET - 0.18) / 0.15) * (t < T_POST + 0.1 ? 1 : 0);
      fillRR(K, FX, FY, fw, FH, 32, '#FFFFFF'); strokeRR(K, FX, FY, fw, FH, 32, focus > 0.5 ? C.ink : HAIR, 3);
      if (focus > 0 && t < T_FLY[0] + FLY_D) {                         // pulsing focus ring before the first letter lands
        const pr = 0.5 + 0.5 * Math.sin((t - T_SHEET) * 14);
        K.save(); K.globalAlpha *= focus * (0.25 + 0.35 * pr); strokeRR(K, FX - 6, FY - 6, fw + 12, FH + 12, 38, C.red, 3); K.restore();
      }
      if (n === 0 && t < T_POST) {
        text(K, 'Add a comment…', FX + 28, FY + 42, { font: F.grot, weight: 500, size: 28, color: '#b3b0a8', align: 'left' });
        if (focus > 0) caretAt(K, FX + 22, FY + 45, 34, t, C.ink);
      } else if (n > 0) {
        const typed = KEY.slice(0, n), lastLand = T_FLY[n - 1] + FLY_D;
        const cw = measure(K, typed, CF) + 32, bump = 1 + 0.08 * ring(t - lastLand, 3, 9);
        X([K], FX + 14 + cw / 2, FY + FH / 2, bump, 0, () => {
          fillRR(K, -cw / 2, -25, cw, 50, 12, 'rgba(255,59,31,0.07)');
          strokeRR(K, -cw / 2, -25, cw, 50, 12, C.red, 3);
          text(K, typed, -cw / 2 + 16, 11, Object.assign({ color: C.red, align: 'left' }, CF));
        });
        caretAt(K, FX + 14 + cw + 6, FY + 45, 34, t, C.ink);
      }
      const full = n === KEY.length, press = win(t, T_POST - 0.07, T_POST + 0.03, 0.04, 0.12);
      X([K], LX + w - 76, FY + FH / 2, 1 - press * 0.18 + 0.1 * ring(t - (T_FLY[4] + FLY_D), 3, 8) * (full ? 1 : 0), 0, () =>
        text(K, 'Post', 0, 10, { font: F.grot, weight: 700, size: 30, color: full || t >= T_POST ? C.red : '#C9C5BC' }));
      if (press > 0.05) { K.save(); K.globalAlpha *= press * 0.18; circle(K, LX + w - 76, FY + FH / 2, 46, C.red); K.restore(); }
      // the posted pill
      if (t >= T_POST) {
        const p = pillAt(K, t, scr);
        const glow = clamp((t - T_POST - 0.16) / 0.25) * (0.8 + 0.2 * Math.sin(t * 7)) * (1 - P(t, T_SETTLE - 0.2, 0.2) * 0.2);
        const dmPing = t > T_DM ? Math.exp(-(t - T_DM) * 6) : 0;          // the pill pings when the DM goes out
        X([K], p.x + p.w / 2, p.y + p.h / 2, lerp(1, 1.06, p.q) + 0.12 * dmPing, lerp(-4, 0, p.q), () => {
          K.save();
          if (glow > 0) { K.shadowColor = `rgba(255,59,31,${0.85 * glow})`; K.shadowBlur = 40 * glow; fillRR(K, -p.w / 2, -p.h / 2, p.w, p.h, p.h / 2, C.red); K.shadowBlur = 0; }
          fillRR(K, -p.w / 2, -p.h / 2, p.w, p.h, p.h / 2, `rgba(255,59,31,${clamp(p.fp * 1.6)})`);
          K.restore();
          strokeRR(K, -p.w / 2, -p.h / 2, p.w, p.h, p.h / 2, C.red, 3);
          text(K, KEY, 0, 10, Object.assign({ color: p.q > 0.45 ? '#FFFFFF' : C.red }, PF));
        });
        const sd = t - T_POST - 0.2;
        if (sd > 0 && sd < 0.42) { const sp = sd / 0.42, e = E.outCubic(sp) * 18; K.save(); K.globalAlpha *= 1 - sp; strokeRR(K, p.x - e, p.y - e, p.w + 2 * e, p.h + 2 * e, p.h / 2 + e, C.red, 4 * (1 - sp) + 1); K.restore(); }
        burst(K, p.x + p.w + 14, p.y + p.h / 2, t - T_POST - 0.16, { n: 8, r0: 14, r1: 60, color: C.red, lw: 5, dur: 0.3 });
      }
    });
  }

  // ── the five letters: lifted out of the card's tag, arcing into the composer ──
  function letters5(T, K, t) {
    if (t < T_FLY[0] || t > T_FLY[4] + FLY_D + 0.01) return;
    const f = sheetTf(t);
    for (let i = 0; i < 5; i++) {
      const p0 = (t - T_FLY[i]) / FLY_D;
      if (p0 < 0 || p0 >= 1) continue;
      const src = letterSrc(K, T_FLY[i], i), cl = chipLetter(K, i), dst = toWorld(f, cl.x, cl.y - 11);
      const at = q => {
        const e = E.inOutCubic(clamp(q));
        const cx = (src.x + dst.x) / 2 + 260 - i * 34, cy = (src.y + dst.y) / 2 + 20;
        const u = 1 - e;
        return { x: u * u * src.x + 2 * u * e * cx + e * e * dst.x, y: u * u * src.y + 2 * u * e * cy + e * e * dst.y, e };
      };
      const glyph = (q, alpha) => {
        const c = at(q), e = c.e;
        const morph = clamp((e - 0.2) / 0.3);                             // lowercase serif → uppercase grotesk
        const s = lerp(1, f.s, e) * (1 + 1.5 * Math.sin(Math.PI * Math.pow(e, 0.8)));
        const rot = (1 - e) * (i % 2 ? 24 : -24) + Math.sin(Math.PI * e) * (i - 2) * 7;
        K.save(); K.globalAlpha *= alpha;
        X([K], c.x, c.y, s, rot, () => {
          if (morph < 1) { K.save(); K.globalAlpha *= 1 - morph; text(K, WORD[i], 0, 9, Object.assign({ color: C.red }, TAGF)); K.restore(); }
          if (morph > 0) { K.save(); K.globalAlpha *= morph; text(K, KEY[i], 0, 11, Object.assign({}, CF, { ls: 0, color: C.red })); K.restore(); }
        });
        K.restore();
      };
      if (p0 > 0.04) {                                                  // red motion streak behind the letter
        K.save(); K.beginPath();
        for (let k = 0; k <= 8; k++) { const g = at(Math.max(0, p0 - 0.16 * k / 8)); k ? K.lineTo(g.x, g.y) : K.moveTo(g.x, g.y); }
        K.strokeStyle = 'rgba(255,59,31,0.35)'; K.lineWidth = 5; K.lineCap = 'round'; K.lineJoin = 'round'; K.stroke(); K.restore();
      }
      glyph(p0, 1);
      // tiny red dot puff on the tone layer at lift-off
      const ld = t - T_FLY[i];
      if (ld < 0.18) { T.save(); T.globalAlpha = 1 - ld / 0.18; circle(T, src.x, src.y, 14 + ld * 120, '#FF0000'); T.restore(); }
    }
  }

  // ── the DM from @creator ──
  const DM = { x: 50, y: 764, w: 740, h0: 188, h1: 498 };
  const LC = { x: 24, y: 188, w: 692, h: 288, th: 176 };               // link card inside the DM
  function dmTf(t) {
    const a = pop(t - T_DM, 2.3, 0.78), q = clamp(a);
    const fl = Math.sin(t * 2.3) * 3 * q * (1 - P(t, T_SETTLE - 0.25, 0.25));
    const ex = pop(t - T_CARD + 0.04, 2.4, 0.62);
    return { cx: lerp(900, DM.x + DM.w / 2, a), top: lerp(1440, DM.y, a) + fl, s: lerp(0.12, 1, a), r: lerp(12, 0, q), a, h: lerp(DM.h0, DM.h1, ex) };
  }
  function vcExt(K, x, y, s, col) {
    K.save(); K.translate(x, y); K.scale(s, s); K.strokeStyle = col; K.lineWidth = 4; K.lineCap = 'round'; K.lineJoin = 'round';
    K.beginPath(); K.moveTo(-9, 9); K.lineTo(9, -9); K.moveTo(-5, -9); K.lineTo(9, -9); K.lineTo(9, 5); K.stroke(); K.restore();
  }
  function dm(T, K, t) {
    if (t < T_DM) return;
    const f = dmTf(t), w = DM.w, h = f.h;
    X([T, K], f.cx, f.top, f.s, f.r, () => {
      const x = -w / 2, y = 0;
      uiCard(T, K, x, y, w, h, { r: 34 });
      // header
      const hp = clamp((t - T_DM) / 0.08);
      K.save(); K.globalAlpha *= hp;
      circle(K, x + 54, y + 48, 30, C.ink);
      text(K, 'A', x + 54, y + 59, { font: F.grot, weight: 700, size: 30, color: '#FFFFFF' });
      circle(K, x + 54, y + 48, 34, null, C.red, 3);
      text(K, '@creator', x + 100, y + 44, { font: F.grot, weight: 700, size: 30, color: C.ink, align: 'left' });
      text(K, '// new message', x + 100, y + 76, { font: F.mono, weight: 500, size: 22, color: G, align: 'left' });
      const sent = t - T_SENT;
      if (sent < 0) {
        const pu = 1 + 0.25 * Math.max(0, Math.sin((t - T_DM) * 9));
        circle(K, x + w - 40, y + 48, 9 * pu, C.red);
        text(K, 'now', x + w - 60, y + 56, { font: F.mono, weight: 500, size: 22, color: G, align: 'right' });
      } else {
        const sp = pop(sent, 3, 0.45);
        X([K], x + w - 44, y + 48, sp, 0, () => { circle(K, 0, 0, 20, C.red); iconCheck(K, 1, 1, 24, clamp(sent / 0.2), '#FFFFFF'); });
        K.save(); K.globalAlpha *= clamp(sent / 0.15);
        text(K, 'delivered', x + w - 76, y + 56 + (1 - clamp(sent / 0.15)) * 10, { font: F.mono, weight: 700, size: 22, color: C.red, align: 'right' });
        K.restore();
        shock(K, x + w - 44, y + 48, sent, { r: 70, color: C.red, lw: 5, dur: 0.4 });
      }
      K.restore();
      line(K, x, y + 96, x + w, y + 96, HAIR, 2, 'butt');
      // message bubble
      const full = "here's the link", msg = typedStr(full, t, T_MSG, MSG_CPS);
      const mf = { font: F.grot, weight: 500, size: 30 };
      if (t >= T_DM + 0.1 && t < T_MSG - 0.04) {                        // typing dots first
        const bp = pop(t - T_DM - 0.1, 3, 0.55);
        X([K], x + 24, y + 112, lerp(0.5, 1, bp), 0, () => {
          fillRR(K, 0, 0, 104, 58, 29, '#F1EFEA');
          for (let k = 0; k < 3; k++) circle(K, 30 + k * 22, 29 - 6 * Math.max(0, Math.sin((t - T_DM) * 16 - k * 1.1)), 7, '#9A968D');
        });
      }
      if (t >= T_MSG - 0.04) {
        const bp = 1;
        const bw = Math.max(70, measure(K, msg, mf) + 48);
        X([K], x + 24, y + 112, 1, 0, () => {
          K.save();
          fillRR(K, 0, 0, bw, 58, 29, '#F1EFEA');
          if (msg) text(K, msg, 24, 40, Object.assign({ color: C.ink, align: 'left' }, mf));
          if (msg.length < full.length) caretAt(K, 24 + measure(K, msg, mf) + 2, 42, 30, t, C.ink);
          K.restore();
        });
      }
      // link card with the real repo screenshot
      if (t >= T_CARD) {
        const cp = pop(t - T_CARD, 2.4, 0.55), cq = clamp(cp);
        const cx0 = x + LC.x, cy0 = y + LC.y;
        X([K], cx0 + LC.w / 2, cy0, lerp(0.75, 1, cp), lerp(-3, 0, cq), () => {
          K.save(); K.globalAlpha *= clamp(cp * 3);
          const lx = -LC.w / 2;
          fillRR(K, lx, 0, LC.w, LC.h, 22, '#FFFFFF');
          K.save(); rr(K, lx, 0, LC.w, LC.h, 22); K.clip();
          const wp = E.outCubic(P(t, T_CARD + 0.03, 0.3));
          K.save(); K.beginPath(); K.rect(lx, 0, LC.w * wp, LC.th); K.clip();
          const im = IMG.gh_readme;                                      // the repo's README: LearnMode / "You build. AI writes."
          if (im && im.naturalWidth) {
            const drift = 1.06 - 0.06 * E.outCubic(P(t, T_CARD, 0.9));      // slow settle-in of the screenshot
            const sw = 1075, sh = sw * LC.th / LC.w, sx = 77, sy = 188;
            const dw = LC.w * drift, dh = LC.th * drift;
            K.drawImage(im, sx, sy, sw, sh, lx + (LC.w - dw) / 2, (LC.th - dh) / 2, dw, dh);
          } else fillRR(K, lx, 0, LC.w, LC.th, 0, '#EEE');
          // shimmer sweep
          const sh2 = P(t, T_CARD + 0.25, 0.4);
          if (sh2 > 0 && sh2 < 1) {
            const sx2 = lx - 200 + (LC.w + 400) * E.inOutCubic(sh2);
            const g = K.createLinearGradient(sx2 - 120, 0, sx2 + 120, 0);
            g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
            K.fillStyle = g; K.fillRect(lx, 0, LC.w, LC.th);
          }
          K.restore();
          line(K, lx, LC.th, lx + LC.w, LC.th, HAIR, 2, 'butt');
          K.restore();
          strokeRR(K, lx, 0, LC.w, LC.h, 22, 'rgba(17,17,17,0.16)', 2.5);
          const tp = clamp((t - T_CARD - 0.12) / 0.14);
          K.save(); K.globalAlpha *= tp;
          text(K, 'LearnMode', lx + 24, LC.th + 50 + (1 - tp) * 12, { font: F.grot, weight: 700, size: 36, color: C.ink, align: 'left', ls: -0.5 });
          text(K, 'github.com/owner/learn-mode', lx + 24, LC.th + 88 + (1 - tp) * 12, { font: F.mono, weight: 500, size: 22, color: G, align: 'left' });
          const sf = { font: F.mono, weight: 700, size: 22 }, sw2 = measure(K, '2.1k', sf) + 62, sx3 = lx + 24 + measure(K, 'LearnMode', { font: F.grot, weight: 700, size: 36, ls: -0.5 }) + 18;
          fillRR(K, sx3, LC.th + 22 + (1 - tp) * 12, sw2, 38, 10, '#F3F1EC'); strokeRR(K, sx3, LC.th + 22 + (1 - tp) * 12, sw2, 38, 10, 'rgba(17,17,17,0.14)', 2);
          text(K, '★', sx3 + 20, LC.th + 49 + (1 - tp) * 12, { font: F.grot, weight: 700, size: 24, color: '#E3A008' });
          text(K, '2.1k', sx3 + 40, LC.th + 49 + (1 - tp) * 12, Object.assign({ color: C.ink, align: 'left' }, sf));
          const nudge = Math.max(0, Math.sin((t - T_CARD) * 6)) * 4 * Math.exp(-(t - T_CARD) * 2.5);
          circle(K, -lx - 46, LC.th + 56, 26, C.red);
          vcExt(K, -lx - 46 + nudge, LC.th + 56 - nudge, 1.05, '#FFFFFF');
          K.restore();
          K.restore();
        });
        // the moment it lands: ring on the card
        const ld = t - T_CARD - 0.1;
        if (ld > 0 && ld < 0.4) { const sp = ld / 0.4, e = E.outCubic(sp) * 16; K.save(); K.globalAlpha *= 1 - sp; strokeRR(K, cx0 - e, cy0 - e, LC.w + 2 * e, LC.h + 2 * e, 22 + e, C.red, 4 * (1 - sp) + 1); K.restore(); }
      }
    });
  }

  // ── focus point (scene coords) that the presenter's finger, eyes and head follow ──
  const SHX = PRESENTER_DOCK.x - 226 * PRESENTER_DOCK.s, SHY = PRESENTER_DOCK.y - 264 * PRESENTER_DOCK.s;   // his left shoulder
  const A_SHEET = { x: 420, y: 752 }, A_TAG = { x: 250, y: 1420 }, A_CHIP = { x: 250, y: 752 }, A_PILL = { x: 280, y: 540 };
  const A_MSG = { x: 200, y: 900 }, A_LINK = { x: 300, y: 1040 };
  const AIMS = [[S0 + 0.08, A_SHEET], [T_SEL - 0.1, A_SHEET], [T_SEL + 0.04, A_TAG], [T_FLY[1], A_TAG], [T_FLY[4] + 0.16, A_CHIP],
    [T_POST - 0.02, A_CHIP], [T_POST + 0.12, A_PILL], [T_DM + 0.04, A_PILL], [T_DM + 0.22, A_MSG], [T_CARD - 0.02, A_MSG], [T_CARD + 0.16, A_LINK]];
  function aimAt(t) {
    if (t <= AIMS[0][0]) return AIMS[0][1];
    for (let i = 0; i < AIMS.length - 1; i++) {
      const [a, pa] = AIMS[i], [b, pb] = AIMS[i + 1];
      if (t < b) { const e = E.inOutCubic(inv(a, b, t)); return { x: lerp(pa.x, pb.x, e), y: lerp(pa.y, pb.y, e) }; }
    }
    return AIMS[AIMS.length - 1][1];
  }

  SC.cta = {
    label: '// 08 — cta', bg: 'light',
    cam: t => {
      if (t < S0 + 0.1) return { x: 0, y: 0, z: 1, r: 0 };
      const push = E.inOutCubic(P(t, T_SHEET + 0.02, 0.45));               // in on the composer
      const back = E.inOutCubic(P(t, T_DM - 0.02, 0.45));                  // ease out for the DM
      const lnk = E.inOutCubic(P(t, T_CARD, 0.45));                        // nudge in on the link
      return {
        z: 1 + 0.1 * push - 0.07 * back + 0.014 * lnk,
        x: 0,
        y: 42 * push - 42 * back - 10 * lnk,
        r: -0.005 * push * (1 - back),
      };
    },
    draw(T, K, t) {
      if (t >= S0 + 0.001) { sheet(T, K, t); dm(T, K, t); }             // both rise from behind the card
      card(T, K, t);
    },
    front(T, K, t) { letters5(T, K, t); },
    guy(t) {
      const d = PRESENTER_DOCK;
      const st = { x: d.x, y: d.y, s: d.s };
      if (t < S0 + 0.001) return st;
      const a = aimAt(t);
      const jig = 7 * ring(t - T_POST, 2.6, 6) * (t > T_POST ? 1 : 0) + 6 * ring(t - T_CARD - 0.1, 2.6, 6) * (t > T_CARD + 0.1 ? 1 : 0);
      const ang = Math.atan2(a.y - SHY, -(a.x - SHX)) / D2R + 12 + jig;   // +12: reads more clearly up-left from the dock
      const hop = t > T_POST ? -14 * Math.sin(TAU * 1.6 * (t - T_POST)) * Math.exp(-4 * (t - T_POST)) : 0;
      const hop2 = t > T_THUMB ? -10 * Math.sin(TAU * 1.6 * (t - T_THUMB)) * Math.exp(-4 * (t - T_THUMB)) : 0;
      const lx = clamp((a.x - 842) / 700, -1, 1) * 0.85, ly = clamp((a.y - 1480) / 900, -1, 1) * 0.85;
      return Object.assign(st, { y: d.y + hop + hop2 },
        arms(t, [
          [S0 + 0.05, END + 1, 'L', 'point', { pointAng: ang }],
          [T_SHEET + 0.02, T_POST - 0.1, 'R', 'shrug'],                    // "Comment…" open palm, inviting
          [T_POST - 0.06, T_DM - 0.04, 'R', 'fist'],                       // posted!
          [T_DM - 0.02, T_THUMB - 0.14, 'R', 'hold'],                      // hands the DM over
          [T_THUMB, END + 1, 'R', 'thumb'],
        ]),
        expr(t, [
          [S0 + 0.04, T_SEL, { brow: 0.6, smile: 0.5 }],
          [T_SEL, T_POST, { brow: 0.85, smile: 0.35 }],
          [T_POST, T_DM, { smile: 1, brow: 0.6 }],
          [T_DM, T_THUMB, { smile: 0.7, brow: 0.35 }],
          [T_THUMB, END + 1, { smile: 0.95, brow: 0.3 }],
          [T_THUMB + 0.1, T_THUMB + 0.42, { wink: 1 }],
        ]),
        { lookX: lx, lookY: ly, headTurn: 0.28 * lx, headTilt: -3 * win(t, T_SEL, T_POST) + 5 * win(t, T_THUMB, END + 1) });
    },
  };
})();
