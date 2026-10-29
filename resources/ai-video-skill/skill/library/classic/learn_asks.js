// ═════════════ 03 · ASKS FIRST  [owi(28)−0.1 ≈ 7.50 → owi(38)−0.1 ≈ 10.10] · classic orange look ═════════════
// NOTE: reference code from a real reel. Word indices (wi(n)) refer to that reel's script; re-cue on your own words.json.
// Through-object left in: learnCard() (kit).
// assets not included: none (all vector drawing).
// "Before Claude writes anything, it asks how you'd approach it."
// Beats: your request (the README's real one: "A note can be in several folders. Deleting a folder should delete its notes.")
// types into a prompt card and is sent → "Claude": a dark code panel (folders.ts) slides in, "Claude · writing" → "writes": the
// naive code starts streaming → "anything": HOLD. The stream freezes and rewinds to nothing, the panel hatches over, a red padlock
// drops and clicks shut (kick), the status rolls to "0 lines written" → "it asks": chip 01 (approach) lights and a "✦ Build
// checkpoint" card shoots out of it while the code panel folds into a slim locked bar → the README's real checkpoint: "Trip ideas"
// sits in Travel and Summer, Travel gets crossed out, a "?" pops on the Summer link, the question writes in → "approach": the answer
// box takes focus (your cursor clicks in, caret blinks, "in your own words…") → the whole exchange is sucked back into chip 01.
// Hand-off: 7.50 and ≥ 9.95 are exactly learnCard(TC) + the presenter at PRESENTER_DOCK, camera identity. Helpers prefixed vwa.
(() => {
  const S0 = owi(28) - 0.1, S1 = owi(38) - 0.1;                                      // 7.50 → 10.10
  const tBefore = owi(28), tClaude = owi(29), tWrites = owi(30), tAny = owi(31);         // 7.60 · 7.86 · 8.12 · 8.38
  const tAsks = owi(33), tHow = owi(34), tApproach = owi(36);                          // 8.94 · 9.19 · 9.54
  const END = 9.95;

  // ── timing ──
  const P_IN = S0 + 0.02;                    // prompt card springs up
  const TYPE0 = tBefore - 0.05, TYPE_GAP = 0.027;
  const SEND = 8.0;
  const CODE_IN = tClaude - 0.08;            // code panel slides in
  const STREAM0 = tWrites - 0.04, CPS = 170; // code streams
  const HOLD = tAny + 0.02;                  // freeze
  const REW0 = HOLD + 0.05, REW_D = 0.18;    // rewind to nothing (lands on 0 as the lock clicks)
  const LOCK0 = HOLD + 0.03, LOCK_LAND = LOCK0 + 0.12, SHUT = REW0 + REW_D;   // padlock slams → clicks shut
  const FOLD0 = tAsks - 0.06, FOLD_D = 0.22; // code panel folds into a bar
  const CP0 = tAsks - 0.03;                  // checkpoint launches from chip 01
  const LINK0 = CP0 + 0.2, TRAVEL_X = tHow + 0.03, QMARK = TRAVEL_X + 0.13;
  const Q0 = CP0 + 0.24, FIELD0 = CP0 + 0.34;
  const CUR0 = tApproach - 0.14, CLICK = tApproach + 0.05;
  const SUCK = [9.66, 9.7, 9.76], SUCK_D = [0.14, 0.14, 0.15];                    // prompt · code bar · checkpoint → chip 01

  // ── layout (scene coords) ──
  const PR = { x: 80, y: 300, w: 920, h: 170 };
  const CD = { x: 80, y: 500, w: 920, h: 330, hh: 66, bar: 74 };
  const CP = { w: 920, h: 630, cx: 540, cy: 925 };                                   // lands at y 610 … 1240
  const CHW = (TC_W - 48 - 16) / 3, CH0 = [TC.x + 24 + CHW / 2, TC.y + 80 + 34];    // chip 01 centre (166.7, 1494)
  const SH_L = [PRESENTER_DOCK.x - 226 * PRESENTER_DOCK.s, PRESENTER_DOCK.y - 264 * PRESENTER_DOCK.s];  // The presenter's screen-left shoulder at the dock

  const G = (size, weight = 500) => ({ font: F.grot, weight, size });
  const M = (size, weight = 500) => ({ font: F.mono, weight, size });
  const GREY = '#8a8780';
  const bez = (a, c, b, u) => [(1 - u) * (1 - u) * a[0] + 2 * (1 - u) * u * c[0] + u * u * b[0], (1 - u) * (1 - u) * a[1] + 2 * (1 - u) * u * c[1] + u * u * b[1]];

  // ── helpers ──
  function vwaA(cs, a, fn) { if (a <= 0.002) return; for (const c of cs) { c.save(); c.globalAlpha *= clamp(a); } fn(); for (const c of cs) c.restore(); }
  function vwaGlow(T, x, y, r, a, red = true) {
    if (a <= 0.003) return;
    const c = red ? '255,0,0' : '0,0,0', g = T.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${c},${Math.min(1, a)})`); g.addColorStop(0.55, `rgba(${c},${Math.min(1, a) * 0.32})`); g.addColorStop(1, `rgba(${c},0)`);
    T.fillStyle = g; T.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function vwaShadow(T, x, y, w, h, r, a = 0.4, blur = 40, off = 22) {
    T.save(); T.shadowColor = `rgba(0,0,0,${a})`; T.shadowBlur = blur; T.shadowOffsetY = off; fillRR(T, x, y, w, h, r, '#FFFFFF'); T.restore();
    fillRR(T, x, y, w, h, r, '#FFFFFF');
  }
  function vwaStar(K, x, y, r, col) {          // ✦ four-point star
    K.beginPath();
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 - Math.PI / 2, rr2 = i % 2 ? r * 0.3 : r; K.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2); }
    K.closePath(); K.fillStyle = col; K.fill();
  }
  function vwaReturn(K, x, y, s, col) {        // ↵ glyph
    K.save(); K.translate(x, y); K.scale(s, s); K.strokeStyle = col; K.lineWidth = 3.2; K.lineCap = 'round'; K.lineJoin = 'round';
    K.beginPath(); K.moveTo(9, -9); K.lineTo(9, 3); K.lineTo(-9, 3); K.stroke();
    K.beginPath(); K.moveTo(-3, -3); K.lineTo(-9, 3); K.lineTo(-3, 9); K.stroke(); K.restore();
  }
  function vwaFolder(K, x, y, s, col, fill) {  // folder glyph centred at x,y (≈ 36×28)
    K.save(); K.translate(x, y); K.scale(s, s);
    K.beginPath(); K.moveTo(-18, -12); K.lineTo(-6, -12); K.lineTo(-2, -7); K.lineTo(18, -7); K.lineTo(18, 13); K.lineTo(-18, 13); K.closePath();
    K.fillStyle = fill; K.fill(); K.lineWidth = 3; K.strokeStyle = col; K.lineJoin = 'round'; K.stroke();
    line(K, -18, -2, 18, -2, col, 2.2); K.restore();
  }
  function vwaDoc(K, x, y, s, col) {           // note glyph (≈ 26×32)
    K.save(); K.translate(x, y); K.scale(s, s);
    K.beginPath(); K.moveTo(-12, -16); K.lineTo(5, -16); K.lineTo(13, -8); K.lineTo(13, 16); K.lineTo(-12, 16); K.closePath();
    K.fillStyle = '#FFFFFF'; K.fill(); K.lineWidth = 3; K.strokeStyle = col; K.lineJoin = 'round'; K.stroke();
    line(K, -6, -2, 7, -2, col, 2.4); line(K, -6, 5, 7, 5, col, 2.4); line(K, -6, 11, 3, 11, col, 2.4); K.restore();
  }
  function vwaLock(K, s, shut, inv = false) { // padlock centred at 0,0 (body 132×104); shut 0 = shackle up/open, 1 = closed; inv = white body (docked on red)
    const body = inv ? '#FFFFFF' : C.red, hole = inv ? C.red : '#FFFFFF';
    K.save(); K.scale(s, s);
    const up = (1 - shut) * 30, tw = (1 - shut) * 0.25;
    K.save(); K.translate(-38, -40 - up); K.rotate(-tw);
    K.beginPath(); K.moveTo(0, 26); K.lineTo(0, -6); K.arc(38, -6, 38, Math.PI, 0); K.lineTo(76, 26 + up * 0.6);
    K.lineWidth = 22; K.strokeStyle = C.ink; K.lineCap = 'round'; K.stroke();
    K.lineWidth = 14; K.strokeStyle = inv ? '#FFFFFF' : '#E8E4DA'; K.stroke(); K.restore();
    fillRR(K, -66, -48, 132, 104, 20, C.ink);
    fillRR(K, -62, -44, 124, 96, 17, body);
    fillRR(K, -62, -44, 124, 14, 8, 'rgba(255,255,255,0.22)');
    circle(K, 0, -2, 13, hole); fillRR(K, -5, 0, 10, 28, 4, hole);
    K.restore();
  }

  // ── focus track (the presenter's point + eyes): [t, x, y]; smooth 0.14 s re-aims ──
  const FOC = [[S0, 300, 1100], [P_IN, 420, 400], [8.0, 400, 650], [HOLD - 0.02, 470, 700], [SHUT - 0.1, 200, 1060], [8.9, 500, 780], [9.2, 230, 850], [9.36, 380, 980], [tApproach - 0.06, 200, 1150], [9.68, 166, 1494]];
  function cpPose(t) {                        // checkpoint card: flight from chip 01, landing, return
    if (t < CP0) return null;
    const p = inAt(t, CP0, 2.3, 0.55), u = E.outCubic(clamp((t - CP0) / 0.24));
    let [x, y] = bez(CH0, [150, 1080], [CP.cx, CP.cy], u);
    let s = lerp(0.14, 1, p), r = (1 - clamp(p)) * -11, a = 1;
    const k = clamp((t - SUCK[2]) / SUCK_D[2]);
    if (k > 0) { const e = E.inCubic(k); [x, y] = bez([CP.cx, CP.cy], [260, 1220], CH0, e); s *= lerp(1, 0.08, e); r += -9 * e; a = 1 - clamp((k - 0.75) / 0.25); }
    if (k >= 1) return null;
    return { x, y, s, r, a, p };
  }
  function focus(t) {
    let i = 0; while (i < FOC.length - 1 && t >= FOC[i + 1][0]) i++;
    const cur = FOC[i], prev = FOC[Math.max(0, i - 1)], k = i ? E.inOutCubic(clamp((t - cur[0]) / 0.14)) : 1;
    let x = lerp(prev[1], cur[1], k), y = lerp(prev[2], cur[2], k);
    // while the checkpoint is in flight, the finger follows it
    const q = cpPose(t), fw = win(t, CP0 + 0.02, CP0 + 0.24, 0.06, 0.12);
    if (q && fw > 0) { x = lerp(x, q.x - 140 * q.s, fw); y = lerp(y, q.y - 120 * q.s, fw); }
    return [x, y];
  }

  // ── camera: [t, fx, fy, z, dy, r] — zoom around the focus so it stays put while everything leans in ──
  const CAMK = [[S0, 540, 960, 1, 0, 0], [7.6, 540, 960, 1, 0, 0], [7.94, 500, 400, 1.045, 0, -0.004], [8.24, 500, 640, 1.04, 6, 0.003],
    [8.68, 400, 900, 1.06, 22, -0.005], [8.92, 540, 800, 1.025, 10, 0.002], [9.24, 540, 900, 1.045, 22, 0.003], [9.6, 360, 1110, 1.058, 34, -0.003],
    [9.8, 380, 1300, 1.03, 10, 0], [END - 0.01, 540, 960, 1, 0, 0]];
  function vwaCam(t) {
    if (t <= S0 + 0.1 || t >= END - 0.01) return { x: 0, y: 0, z: 1, r: 0 };
    let i = 0; while (i < CAMK.length - 2 && t >= CAMK[i + 1][0]) i++;
    const a = CAMK[i], b = CAMK[i + 1], k = E.inOutCubic(clamp((t - a[0]) / (b[0] - a[0])));
    const v = j => lerp(a[j], b[j], k), z = v(3);
    const live = win(t, 7.62, 9.86, 0.2, 0.1);
    return { x: -(v(1) - 540) * (z - 1) + Math.sin(t * 1.9) * 3 * live, y: -(v(2) - 960) * (z - 1) + v(4) + Math.cos(t * 1.6) * 2 * live, z, r: v(5) * live };
  }

  // ── PROMPT card: your request (README's real example) ──
  const PL = [['A', 'note', 'can', 'be', 'in', 'several', 'folders.'], ['Deleting', 'a', 'folder', 'should', 'delete', 'its', 'notes.']];
  let PW = null;
  function promptCard(T, K, t) {
    const w = PR.w, h = PR.h, f = G(38);
    if (!PW) { PW = []; PL.forEach((ln, li) => { let x = 36; ln.forEach(wd => { PW.push({ wd, li, x }); x += measure(K, wd + ' ', f); }); }); }
    vwaShadow(T, 0, 0, w, h, 26, 0.36, 36, 20);
    fillRR(K, 0, 0, w, h, 26, '#FFFFFF'); strokeRR(K, 0, 0, w, h, 26, HAIR, 3);
    // label: you
    circle(K, 46, 40, 15, C.ink); text(K, 'you', 46, 46, M(15, 700));
    text(K, '// your request', 72, 48, Object.assign({ color: GREY, align: 'left' }, M(23)));
    // words type in
    let lastX = 36, lastLi = 0;
    PW.forEach((o, i) => {
      const d = t - TYPE0 - i * TYPE_GAP; if (d < 0) return;
      const a = clamp(d / 0.05), rise = (1 - E.outCubic(clamp(d / 0.12))) * 12;
      vwaA([K], a, () => text(K, o.wd, o.x, 104 + o.li * 48 + rise, Object.assign({ color: C.ink, align: 'left' }, f)));
      lastX = o.x + measure(K, o.wd, f) + 6; lastLi = o.li;
    });
    if (t >= TYPE0 && t < SEND && Math.floor((t - TYPE0) / 0.11) % 2 === 0) fillRR(K, lastX, 72 + lastLi * 48, 4, 42, 2, C.red);
    // send key: presses on SEND, flips red, then reads "sent"
    const pr = win(t, SEND - 0.04, SEND + 0.04, 0.04, 0.08), sent = t >= SEND;
    X([K], w - 96, 44, 1 - 0.12 * pr + 0.08 * ring(t - SEND - 0.06, 4, 10), 0, () => {
      fillRR(K, -66, -22, 132, 44, 22, sent ? C.red : C.ink);
      vwaReturn(K, -36, 0, 0.9, '#FFFFFF');
      text(K, sent ? 'sent' : 'send', 14, 8, Object.assign({ color: '#FFFFFF' }, M(21, 700)));
    });
  }

  // ── CODE panel (dark): Claude starts writing → held ──
  const CODE = ['async function deleteFolder(id) {', '  await db.notes.deleteMany({ folderId: id })'];
  const KW = new Set(['async', 'function', 'await']), DIM = new Set(['db', 'notes']), ARG = new Set(['id', 'folderId']);
  const colorsOf = s => { const out = []; const re = /[A-Za-z_]+|\s+|./g; let m; while ((m = re.exec(s))) { const tk = m[0], nx = s[re.lastIndex];
    const c = KW.has(tk) ? '#FF7A59' : ARG.has(tk) ? '#F5C98B' : DIM.has(tk) ? '#BDB8AE' : /^[A-Za-z_]/.test(tk) ? (nx === '(' ? '#FFFFFF' : '#E8E4DA') : '#8E8B85';
    for (const _ of tk) out.push(c); } return out; };
  const CODE_C = CODE.map(colorsOf);
  const TOTAL = CODE[0].length + CODE[1].length;
  function typed(t) {                          // chars visible (streaming, then the rewind)
    if (t < STREAM0) return 0;
    const peak = Math.min(TOTAL, Math.floor((HOLD - STREAM0) * CPS));
    if (t < HOLD) return Math.min(peak, Math.floor((t - STREAM0) * CPS));
    return Math.round(peak * (1 - E.inOutCubic(clamp((t - REW0) / REW_D))));
  }
  const foldP = t => E.inOutCubic(clamp((t - FOLD0) / FOLD_D));
  let CW = 0, PILL = [900, 530];
  // big "lines written" counter under the panel: 0 → 1 → 2 … rewinds → red 0, then flies into the status pill on the fold
  const linesAt = t => { const n = typed(t); return n === 0 ? 0 : n > CODE[0].length ? 2 : 1; };
  const CTR = { x: 112, y: 1176, size: 300 };
  function vwaRoll(K, v, x, y, size, col) {     // one rolling digit, left-aligned at x
    const f = G(size, 700), dw = measure(K, '0', f), top = y - size * 0.76, hgt = size * 0.92, d0 = Math.floor(v);
    K.save(); K.beginPath(); K.rect(x - 20, top, dw + 40, size * 0.8); K.clip();
    for (const d of [d0, d0 + 1]) text(K, String(((d % 10) + 10) % 10), x + dw / 2, y + (d - v) * hgt, Object.assign({ color: col, ls: 0 }, f));
    K.restore(); return dw;
  }
  function counter(T, K, t) {
    if (t < CODE_IN + 0.04) return;
    const fp = foldP(t);
    let v = 0; for (let k = 0; k < 6; k++) v += linesAt(t + 0.03 - k * 0.012); v /= 6;   // centred box filter → a quick roll that lands on the beat
    const zero = t >= SHUT - 0.01, a = clamp((t - CODE_IN - 0.04) / 0.12) * (1 - E.inCubic(fp));
    const ent = E.outBack(clamp((t - CODE_IN - 0.04) / 0.22));
    const ax = CTR.x + 80, ay = CTR.y - 110;     // anchor: centre of the digit
    const s = lerp(0.8, 1, ent) * (1 + 0.12 * ring(t - SHUT, 3.5, 8)) * lerp(1, 0.08, E.inCubic(fp));
    const x = lerp(ax, PILL[0], E.inOutCubic(fp)), y = lerp(ay, PILL[1], E.inOutCubic(fp));
    if (a <= 0.003) return;
    if (zero) { shock(K, ax, ay, t - SHUT, { r: 300, color: C.red, lw: 8, dur: 0.4 }); burst(K, ax - 10, ay, t - SHUT, { n: 10, r0: 140, r1: 200, color: C.red, lw: 7, dur: 0.26, rot: 0.6 }); }
    vwaA([K], a, () => X([K], x, y, s, -3 * fp, () => {
      const col = zero ? C.red : t < STREAM0 ? '#C9C4BA' : C.ink;
      vwaRoll(K, v, -80, 110, CTR.size, col);
      vwaA([K], 1 - clamp(fp * 3), () => {
        text(K, 'lines of code', 120, 10, Object.assign({ color: C.ink, align: 'left' }, G(54, 600)));
        text(K, 'written', 120, 98, { font: F.serif, italic: true, weight: 400, size: 100, color: zero ? C.red : C.ink, align: 'left' });
        if (zero) { const k = E.outCubic(clamp((t - SHUT) / 0.16)); vwaA([K], k, () => text(K, '// so far', 124 + 300, 98, Object.assign({ color: GREY, align: 'left' }, M(26)))); }
      });
    }));
  }
  function codePanel(T, K, t) {
    const w = CD.w, fp = foldP(t), h = lerp(CD.h, CD.bar, fp), hh = CD.hh;
    if (!CW) CW = measure(K, 'M', M(28));
    const held = t >= HOLD, n = typed(t), lines = n === 0 ? 0 : n > CODE[0].length ? 2 : 1;
    vwaShadow(T, 0, 0, w, h, 24, 0.5, 40, 24);
    fillRR(K, 0, 0, w, h, 24, '#15161A');
    // header
    [0, 1, 2].forEach(i => circle(K, 32 + i * 24, h > hh + 4 ? hh / 2 : h / 2, 7, '#3A3C44'));
    const hy = h > hh + 4 ? hh / 2 : h / 2;
    text(K, 'folders.ts', 118, hy + 9, Object.assign({ color: '#E8E4DA', align: 'left' }, M(24, 500)));
    if (fp < 0.98) line(K, 0, hh, w, hh, 'rgba(255,255,255,0.08)', 2, 'butt');
    // status pill: "Claude · writing" → red "N lines written" (+ lock once docked)
    const pf = M(22, 700), lockIn = fp;
    const str = !held ? 'Claude · writing' : fp < 0.5 ? 'held' : '0 lines written';
    const wA = measure(K, 'held', pf) + 50, wB = measure(K, '0 lines written', pf) + 84;
    const flip = held ? clamp((t - HOLD) / 0.1) : 1, pw = held ? lerp(wA, wB, fp) : measure(K, str, pf) + 50, ph = 40, px = w - 22 - pw, py = hy - ph / 2;
    PILL = [CD.x + px + 30, CD.y + hy];
    K.save(); K.translate(px + pw / 2, hy);
    const sq = held && flip < 1 ? Math.max(0.15, Math.abs(Math.cos(Math.PI * flip))) : 1;
    K.scale(1 + 0.08 * ring(t - HOLD, 4, 9) + 0.07 * ring(t - REW0 - REW_D, 4, 9), sq);
    fillRR(K, -pw / 2, -ph / 2, pw, ph, ph / 2, held ? C.red : '#2A2C33');
    if (!held) circle(K, -pw / 2 + 22, 0, 6 + Math.sin(t * 24) * 1.5, '#FF7A59');
    else if (lockIn < 0.5) vwaA([K], 1 - lockIn * 2, () => { fillRR(K, -pw / 2 + 16, -8, 4, 16, 2, '#FFFFFF'); fillRR(K, -pw / 2 + 24, -8, 4, 16, 2, '#FFFFFF'); });
    vwaA([K], held ? Math.abs(fp - 0.5) * 2 : 1, () => text(K, str, -pw / 2 + 40 + lockIn * 34, 8, Object.assign({ color: '#FFFFFF', align: 'left' }, pf)));
    K.restore();
    const lockDock = [px + 30, hy];
    // code area (clipped so the fold eats it)
    if (h > hh + 2) {
      K.save(); K.beginPath(); K.rect(0, hh, w, h - hh); K.clip();
      [1, 2, 3, 4].forEach(i => text(K, String(i), 40, hh + 56 * i - 4, Object.assign({ color: '#4A4C54', align: 'center' }, M(26, 500))));
      // streamed code, char by char
      let left = n, cx = 0, cy = 0;
      CODE.forEach((s, li) => {
        const k = Math.max(0, Math.min(s.length, left)); left -= s.length;
        for (let j = 0; j < k; j++) if (s[j] !== ' ') text(K, s[j], 78 + j * CW + CW / 2, hh + 56 * (li + 1) - 4, Object.assign({ color: CODE_C[li][j] }, M(28, 500)));
        if (k > 0) { cx = 78 + k * CW; cy = hh + 56 * (li + 1); }
      });
      if (n === 0) { cx = 78; cy = hh + 56; }
      // caret: a solid block while writing, a red one that rewinds
      const rew = t >= REW0 && t < REW0 + REW_D + 0.08;
      if (t >= CODE_IN && (t < HOLD || rew)) fillRR(K, cx + 2, cy - 36, 14, 40, 3, rew ? C.red : '#FFFFFF');
      // held: red hatching sweeps over the code area
      const hp = clamp((t - LOCK_LAND) / 0.18);
      if (hp > 0) {
        K.save(); K.beginPath(); K.rect(0, hh, w * E.outCubic(hp), h - hh); K.clip();
        K.strokeStyle = 'rgba(255,59,31,0.16)'; K.lineWidth = 14;
        for (let x = -h; x < w + h; x += 38) { K.beginPath(); K.moveTo(x, h); K.lineTo(x + h, hh); K.stroke(); }
        K.restore();
      }
      K.restore();
    }
    return { lockDock, h };
  }

  // ── the padlock (dropped on HOLD, docks into the status pill on the fold) ──
  function padlock(T, K, t, lockDock) {
    if (t < LOCK0) return;
    const fp = foldP(t);
    const land = E.inQuart(clamp((t - LOCK0) / (LOCK_LAND - LOCK0)));
    const cx = CD.w * 0.5, cyL = CD.hh + (CD.h - CD.hh) / 2 + 6;
    let y = lerp(cyL - 50, cyL, land), x = cx;
    let s = (1 + 0.1 * ring(t - LOCK_LAND, 3.5, 9) + 0.06 * ring(t - SHUT, 5, 12)) * lerp(2.4, 1, land);
    const sq = t >= LOCK_LAND ? 1 - 0.14 * Math.max(0, ring(t - LOCK_LAND, 3.5, 12)) : 1;
    x = lerp(x, lockDock[0], fp); y = lerp(y, lockDock[1], fp); s *= lerp(1, 0.2, fp);
    const shut = E.outBackX(clamp((t - SHUT + 0.05) / 0.08));
    // contact shadow on the dark panel
    if (fp < 0.6 && land > 0.2) vwaA([K], (1 - fp / 0.6) * land, () => { K.fillStyle = 'rgba(0,0,0,0.5)'; K.beginPath(); K.ellipse(x, cyL + 66 * s, 92 * s * land, 14 * s, 0, 0, TAU); K.fill(); });
    vwaA([K], clamp(land * 4), () => X([K], x, y, 1, (1 - land) * 10, () => { K.scale(1 / sq * 0.5 + 0.5, sq); vwaLock(K, s, shut, fp > 0.5); }));
    shock(K, x, y, t - SHUT, { r: 260, color: C.red, lw: 7, dur: 0.38 });
    burst(K, x, y, t - SHUT, { n: 12, r0: 120, r1: 230, color: '#FFFFFF', lw: 6, dur: 0.3 });
  }

  // ── CHECKPOINT card (README's real Build checkpoint) ──
  const Q = [['When', 'someone', 'deletes', 'Travel,', 'what', 'should'], ['happen', 'to', 'that', 'note', 'in', 'Summer?']];
  let QW = null;
  function checkpoint(T, K, t) {
    const w = CP.w, h = CP.h, f = G(36);
    if (!QW) { QW = []; Q.forEach((ln, li) => { let x = 40; ln.forEach(wd => { QW.push({ wd, li, x }); x += measure(K, wd + ' ', f); }); }); }
    uiCard(T, K, 0, 0, w, h, { r: 30 });
    // header + divider
    vwaStar(K, 54, 50, 17 * (1 + 0.25 * ring(t - CP0 - 0.18, 4, 8)), C.red);
    text(K, 'Build checkpoint', 84, 60, Object.assign({ color: C.red, align: 'left' }, M(30, 700)));
    text(K, '// learn-mode', w - 40, 58, Object.assign({ color: GREY, align: 'right' }, M(23)));
    const dv = E.outCubic(clamp((t - CP0 - 0.14) / 0.2));
    line(K, 40, 88, 40 + (w - 80) * dv, 88, C.red, 3, 'butt');
    text(K, 'Deleting a shared note', 40, 152, Object.assign({ color: C.ink, align: 'left' }, G(50, 700)));

    // diagram: [Travel] — (Trip ideas) — [Summer]
    const dy = 246, lp = E.outCubic(clamp((t - LINK0) / 0.18)), tx = clamp((t - TRAVEL_X) / 0.16);
    const nt = { x: 460, w: 236, h: 80 }, tv = { x: 150, w: 210, h: 70 }, sm = { x: 772, w: 228, h: 70 };
    // links
    const l1a = tv.x + tv.w / 2, l1b = nt.x - nt.w / 2, l2a = nt.x + nt.w / 2, l2b = sm.x - sm.w / 2;
    if (lp > 0) {
      if (tx <= 0) line(K, l1b, dy, lerp(l1b, l1a, lp), dy, C.ink, 4);
      else { // Travel link snaps: dashed red, gap opening
        const gap = 22 * E.outBack(tx);
        K.save(); K.setLineDash([9, 9]); line(K, l1a, dy, (l1a + l1b) / 2 - gap, dy, C.red, 4, 'butt'); line(K, (l1a + l1b) / 2 + gap, dy, l1b, dy, C.red, 4, 'butt'); K.restore();
      }
      line(K, l2a, dy, lerp(l2a, l2b, lp), dy, C.ink, 4);
    }
    // note card
    X([K], nt.x, dy, 1 + 0.05 * ring(t - LINK0, 4, 9), 0, () => {
      fillRR(K, -nt.w / 2, -nt.h / 2, nt.w, nt.h, 16, '#FFFFFF'); strokeRR(K, -nt.w / 2, -nt.h / 2, nt.w, nt.h, 16, C.ink, 3.5);
      vwaDoc(K, -nt.w / 2 + 34, 0, 1.1, C.ink);
      text(K, 'Trip ideas', -nt.w / 2 + 62, 11, Object.assign({ color: C.ink, align: 'left' }, G(31, 700)));
    });
    // Travel tag: crossed out on "how"
    const tvp = clamp((t - LINK0 + 0.04) / 0.14);
    if (tvp > 0) X([K], tv.x, dy + (tx > 0 ? 6 * E.outCubic(tx) : 0), E.outBack(tvp) * (1 - 0.06 * E.outCubic(tx)), -4 * E.outCubic(tx), () => {
      fillRR(K, -tv.w / 2, -tv.h / 2, tv.w, tv.h, 14, tx > 0.3 ? '#FFE6E0' : '#F1EFEA'); strokeRR(K, -tv.w / 2, -tv.h / 2, tv.w, tv.h, 14, tx > 0.3 ? C.red : 'rgba(17,17,17,0.22)', 3);
      vwaFolder(K, -tv.w / 2 + 34, 0, 1, tx > 0.3 ? C.red : C.ink, '#FFFFFF');
      text(K, 'Travel', -tv.w / 2 + 62, 11, Object.assign({ color: tx > 0.3 ? C.red : C.ink, align: 'left' }, G(31, 600)));
      if (tx > 0) line(K, -tv.w / 2 + 56, 1, -tv.w / 2 + 56 + 112 * E.outCubic(tx), 1, C.red, 4);
    });
    if (tx > 0) X([K], tv.x + tv.w / 2 - 6, dy - tv.h / 2 - 4, E.outBack(clamp(tx * 1.4)), 0, () => { circle(K, 0, 0, 20, C.red, C.ink, 3); cross(K, 0, 0, 16, clamp(tx * 1.6 - 0.3), '#FFFFFF', 5); });
    // Summer tag
    const smp = clamp((t - LINK0 - 0.02) / 0.14);
    if (smp > 0) X([K], sm.x, dy, E.outBack(smp), 0, () => {
      fillRR(K, -sm.w / 2, -sm.h / 2, sm.w, sm.h, 14, '#F1EFEA'); strokeRR(K, -sm.w / 2, -sm.h / 2, sm.w, sm.h, 14, 'rgba(17,17,17,0.22)', 3);
      vwaFolder(K, -sm.w / 2 + 34, 0, 1, C.ink, '#FFFFFF');
      text(K, 'Summer', -sm.w / 2 + 62, 11, Object.assign({ color: C.ink, align: 'left' }, G(31, 600)));
    });
    // "?" on the Summer link
    const qp = t - QMARK;
    if (qp > 0) X([K], (l2a + l2b) / 2, dy - 44 + Math.sin(t * 9) * 2, E.outBackX(clamp(qp / 0.16)), 8 * ring(qp, 3, 6), () => {
      circle(K, 0, 0, 26, C.red, C.ink, 3); text(K, '?', 0, 12, Object.assign({ color: '#FFFFFF' }, G(36, 700)));
    });

    // the question writes in
    QW.forEach((o, i) => {
      const d = t - Q0 - i * 0.022; if (d < 0) return;
      const a = clamp(d / 0.06), rise = (1 - E.outCubic(clamp(d / 0.14))) * 14;
      const hot = o.wd.startsWith('Summer');
      vwaA([K], a, () => text(K, o.wd, o.x, 372 + o.li * 48 + rise, Object.assign({ color: hot ? C.red : C.ink, align: 'left' }, hot ? G(36, 700) : f)));
    });

    // answer box: your approach
    const fa = E.outCubic(clamp((t - FIELD0) / 0.18)), foc = clamp((t - CLICK) / 0.1);
    if (fa > 0) vwaA([K], fa, () => {
      K.save(); K.translate(0, (1 - fa) * 24);
      text(K, '// your approach', 40, 470, Object.assign({ color: foc > 0 ? C.red : GREY, align: 'left' }, M(24, foc > 0 ? 700 : 500)));
      const fx = 40, fy = 488, fw = w - 80, fh = 100;
      fillRR(K, fx, fy, fw, fh, 18, '#FFFFFF');
      strokeRR(K, fx, fy, fw, fh, 18, foc > 0 ? C.ink : HAIR, foc > 0 ? 4 : 3);
      if (foc > 0) { const g = 8 * E.outCubic(foc); vwaA([K], 1 - 0.4 * foc, () => strokeRR(K, fx - g, fy - g, fw + g * 2, fh + g * 2, 18 + g, C.red, 3)); }
      text(K, 'in your own words…', fx + 44, fy + 63, { font: F.serif, italic: true, weight: 400, size: 40, color: '#B3AFA6', align: 'left' });
      if (foc > 0 && Math.floor((t - CLICK) / 0.13) % 2 === 0) fillRR(K, fx + 26, fy + 26, 5, 50, 2.5, C.red);
      // answer key
      X([K], fx + fw - 92, fy + fh / 2, 1 + 0.06 * ring(t - CLICK, 4, 9), 0, () => {
        fillRR(K, -70, -26, 140, 52, 26, foc > 0 ? C.ink : '#E3DED3');
        vwaReturn(K, -38, 0, 0.95, '#FFFFFF');
        text(K, 'reply', 14, 8, Object.assign({ color: '#FFFFFF' }, M(22, 700)));
      });
      K.restore();
    });
  }

  // sucked back into chip 01 (center-based pose) for prompt / code bar
  function suckPose(t, i, cx, cy) {
    const k = clamp((t - SUCK[i]) / SUCK_D[i]);
    if (k <= 0) return { x: cx, y: cy, s: 1, r: 0, a: 1, k };
    const e = E.inCubic(k), [x, y] = bez([cx, cy], [cx - 260, (cy + CH0[1]) / 2], CH0, e);
    return { x, y, s: lerp(1, 0.08, e), r: (i ? 8 : -8) * e, a: 1 - clamp((k - 0.75) / 0.25), k };
  }

  kick(SHUT, 0.6, 0.55);   // the one punch: the padlock clicks shut

  SC.asks = {
    label: '// 03 — asks first', bg: 'light',
    cam: t => vwaCam(t),
    draw(T, K, t) {
      if (t < S0 + 0.001 || t >= END) { learnCard(T, K, TC.x, TC.y, TC.s, { t }); return; }
      // halftone glows behind the focus
      vwaGlow(T, CD.x + CD.w / 2, CD.y + 200, 560, 0.34 * Math.exp(-Math.max(0, t - SHUT) * 2.6) * (t >= SHUT ? 1 : 0), true);
      vwaGlow(T, CP.cx, CP.cy, 640, 0.16 * win(t, CP0 + 0.1, SUCK[2], 0.2, 0.12), false);

      // learning card: chip 01 pulses as the checkpoint launches; small bump as the exchange lands back
      const bump = (0.03 * ring(t - SUCK[2] - SUCK_D[2], 4, 12) + 0.02 * ring(t - SUCK[0] - SUCK_D[0], 4, 12)) * (t > SUCK[0] + SUCK_D[0] ? 1 : 0) * clamp((END - 0.01 - t) / 0.05);
      if (Math.abs(bump) < 1e-4) learnCard(T, K, TC.x, TC.y, TC.s, { t });
      else X([T, K], CH0[0], CH0[1], 1 + bump, 0, () => learnCard(T, K, TC.x - CH0[0], TC.y - CH0[1], TC.s, { t }));
      shock(K, CH0[0], CH0[1], t - CP0, { r: 170, color: C.red, lw: 6, dur: 0.34 });
      if (t > CP0 - 0.02 && t < SUCK[2] + SUCK_D[2] && t < END - 0.02) {
        const a = Math.min(clamp((t - CP0 + 0.02) / 0.08), 1 - clamp((t - CP0 - 0.5) / 0.2)) + clamp((t - SUCK[2]) / 0.06);
        vwaA([K], Math.min(1, a), () => strokeRR(K, TC.x + 24 - 5, TC.y + 80 - 5, CHW + 10, 78, 18, C.red, 3));
      }

      // ── code panel (behind the prompt so it can slide up from under it) ──
      let dock = null;
      if (t >= CODE_IN) {
        const p = inAt(t, CODE_IN, 2.4, 0.5);
        const jolt = t >= HOLD ? 7 * ring(t - HOLD, 6, 10) : 0;
        const ccx = CD.x + CD.w / 2, ccy = CD.y + lerp(CD.h, CD.bar, foldP(t)) / 2;
        const sp = suckPose(t, 1, ccx, ccy);
        if (sp.k < 1) vwaA([T, K], sp.a * clamp(p * 2), () => X([T, K], sp.x + jolt, sp.y + (1 - p) * 160, sp.s * lerp(0.92, 1, p), sp.r + (1 - clamp(p)) * 3, () => {
          const h = lerp(CD.h, CD.bar, foldP(t));
          T.translate(-CD.w / 2, -h / 2); K.translate(-CD.w / 2, -h / 2);
          const r = codePanel(T, K, t); dock = r.lockDock;
          padlock(T, K, t, dock);
        }));
      }
      counter(T, K, t);
      // ── prompt card ──
      {
        const p = inAt(t, P_IN, 2.5, 0.5);
        const lift = -6 * win(t, SEND - 0.02, SEND + 0.12, 0.04, 0.1);
        const sp = suckPose(t, 0, PR.x + PR.w / 2, PR.y + PR.h / 2);
        if (p > 0.001 && sp.k < 1) vwaA([T, K], sp.a * clamp(p * 2.5), () => X([T, K], sp.x, sp.y + (1 - p) * 180 + lift, sp.s * lerp(0.9, 1, p), sp.r + (1 - clamp(p)) * -3, () => {
          T.translate(-PR.w / 2, -PR.h / 2); K.translate(-PR.w / 2, -PR.h / 2); promptCard(T, K, t);
        }));
      }
      // ── checkpoint ──
      const q = cpPose(t);
      if (q) {
        // speed streaks behind it in flight
        const fl = 1 - clamp((t - CP0 - 0.16) / 0.1);
        if (t > CP0 && fl > 0) vwaA([K], fl * 0.8, () => {
          for (let k = 0; k < 3; k++) { const u0 = Math.max(0, E.outCubic(clamp((t - CP0) / 0.24)) - 0.22 - k * 0.05), u1 = E.outCubic(clamp((t - CP0) / 0.24)) - 0.04;
            if (u1 <= u0) continue; const A = bez(CH0, [150, 1080], [CP.cx, CP.cy], u0), B = bez(CH0, [150, 1080], [CP.cx, CP.cy], u1);
            line(K, A[0] + (k - 1) * 70, A[1], B[0] + (k - 1) * 70, B[1], k === 1 ? C.red : C.ink, 8 - k * 2); }
        });
        vwaA([T, K], q.a, () => X([T, K], q.x, q.y, q.s, q.r, () => { T.translate(-CP.w / 2, -CP.h / 2); K.translate(-CP.w / 2, -CP.h / 2); checkpoint(T, K, t); }));
        burst(K, CP.cx - CP.w / 2 + 54, CP.cy - CP.h / 2 + 50, t - CP0 - 0.2, { n: 10, r0: 30, r1: 80, color: C.red, lw: 5, dur: 0.28 });
      }
      // landing sparks in chip 01 as the prompt / bar arrive
      for (const i of [0, 1]) shock(K, CH0[0], CH0[1], t - SUCK[i] - SUCK_D[i], { r: 110, color: C.red, lw: 5, dur: Math.min(0.24, END - 0.02 - SUCK[i] - SUCK_D[i]) });
    },
    front(T, K, t) {
      if (t < CUR0 || t >= SUCK[2]) return;
      // your cursor flies in and clicks into the answer box
      const q = cpPose(t); if (!q) return;
      const tx = q.x - CP.w / 2 + 40 + 120, ty = q.y - CP.h / 2 + 488 + 56;
      const u = E.outCubic(clamp((t - CUR0) / 0.18));
      const [x, y] = bez([tx + 420, ty + 260], [tx + 260, ty + 30], [tx, ty], u);
      const press = win(t, CLICK - 0.03, CLICK + 0.06, 0.03, 0.08);
      vwaA([K], clamp((t - CUR0) / 0.06) * (1 - clamp((t - SUCK[2] + 0.06) / 0.06)), () => cursor(K, x, y, 0.62, press));
      shock(K, tx, ty, t - CLICK, { r: 90, color: C.red, lw: 5, dur: 0.3 });
    },
    guy(t) {
      const d = PRESENTER_DOCK, st = { x: d.x, y: d.y, s: d.s };
      const [fx, fy] = focus(t);
      const ang = Math.atan2(fy - SH_L[1], SH_L[0] - fx) / D2R;
      const lx = clamp((fx - d.x) / 520, -1, 1) * 0.85, ly = clamp((fy - 1450) / 900, -1, 1) * 0.85;
      return Object.assign(st,
        arms(t, [[tApproach - 0.08, SUCK[1], 'R', 'hold']]),
        { armL: 'point', armLp: 1, pointAng: clamp(ang, -86, 10) },
        expr(t, [[S0 + 0.05, HOLD - 0.06, { brow: 0.45, smile: 0.3 }],
          [HOLD - 0.04, FOLD0, { browTilt: 0.7, brow: 0.2, smile: -0.25, shock: 0.2 }],
          [CP0, tApproach - 0.08, { smile: 0.55, brow: 0.7 }],
          [tApproach - 0.06, END, { smile: 0.7, brow: 0.35 }]]),
        { lookX: lx, lookY: ly, headTurn: 0.22 * lx,
          headTilt: -4 * win(t, HOLD - 0.04, FOLD0, 0.1, 0.2) + 6 * win(t, tApproach - 0.06, END, 0.12, 0.2) - 3 * win(t, 7.6, 8.36, 0.15, 0.15) });
    },
  };
})();
