// ═════════════ 06 · THE MAP  [owi(70)−0.1 ≈ 17.82 → owi(86)−0.1 ≈ 21.42] · classic orange look ═════════════
// NOTE: reference code from a real reel. Word indices (wi(n)) refer to that reel's script; re-cue on your own words.json.
// Through-object left in: learnCard() (kit).
// assets not included: none (all vector drawing).
// "On an existing project, it first sketches a little map of how the pieces fit together."
// Beats: "On an existing project" → a repo explorer card (~/notes-app) springs up from below and its file tree pours in row by row,
// crooked and messy; red "?" markers pop on the files that matter and a dashed import tangle scribbles between them (you don't know
// how this fits) → "it first" → Claude inspects: a red scan bar sweeps the tree, every row snaps straight as it is read, each "?"
// flips into its role tag (UI / API / DB), the rest dims, and the footer ticks entry points · storage · deps (onboarding.md) →
// "sketches" → the card becomes .learn-mode/project-map.md (## Main Flow, graph paper): the untagged rows drop away, the tagged files
// fly into place and a red pencil sketches a hand-drawn box around each group, then arrows fetch('/api/notes') → prisma.note.findMany()
// → "map" chip 06 lights (ring) → "how the pieces" → a request packet runs UI → API → DB, each box pulses, the response runs back →
// "fit" → the crooked boxes snap into line (kick), "saved ✓" → "together" → the map folds into chip 06 of the learning-mode card.
// Hand-off: ≤ 17.97 and ≥ 21.27 exactly learnCard(TC) + the presenter at PRESENTER_DOCK, camera identity. Helpers prefixed mp.
(() => {
  const S0 = owi(70) - 0.1, END = owi(86) - 0.1;              // 17.82 → 21.42
  const H0 = S0 + 0.15, H1 = END - 0.15;                     // 17.97 · 21.27
  const tProj = owi(73), tIt = owi(74), tSk = owi(76), tMap = owi(79), tHow = owi(81), tPieces = owi(83), tFit = owi(84), tTog = owi(85);

  // ── timing ──
  const CARD_IN = H0 - 0.005;
  const ROW_T = i => CARD_IN + 0.05 + i * 0.032;             // tree pours in 18.02 → 18.31
  const Q_T = k => tProj - 0.04 + k * 0.06;                   // "?" markers 18.48 → 18.72
  const TANG_T = k => tProj - 0.12 + k * 0.07;               // tangle scribbles
  const SCAN0 = tIt - 0.06, SCAN_D = 0.36;                    // 18.94 → 19.30
  const MORPH0 = tSk - 0.05, MORPH_D = 0.3;                   // card → project-map.md
  const FLY = [tSk - 0.04, tSk + 0.04, tSk + 0.12], FLY_D = 0.25;     // tagged files fly into the map, group by group 19.28 → 19.74
  const PEN = [[tSk + 0.17, tSk + 0.36, 'box', 0], [tSk + 0.36, tSk + 0.45, 'arr', 0], [tSk + 0.45, tSk + 0.63, 'box', 1],
    [tSk + 0.63, tSk + 0.71, 'arr', 1], [tSk + 0.71, tSk + 0.89, 'box', 2]];      // 19.49 → 20.21
  const PEN_IN = PEN[0][0] - 0.08, PEN_OUT = PEN[4][1] + 0.02;
  const PK0 = tHow + 0.02;                                   // request packet 20.26 → DB 20.56, response back → 20.76
  const PK = { a0: [PK0 + 0.02, PK0 + 0.13], a1: [PK0 + 0.18, PK0 + 0.29], b1: [PK0 + 0.34, PK0 + 0.43], b0: [PK0 + 0.45, PK0 + 0.54] };
  const HIT = [PK0, PK.a0[1], PK.a1[1]];                     // box pulses (request)
  const FIT = tFit + 0.01;                                    // 20.81 boxes snap
  const OUT0 = tTog + 0.0, OUT1 = tTog + 0.2;                 // 20.96 → 21.16 into chip 06
  const LBL_T = [PEN[1][1] - 0.02, PEN[3][1] - 0.02];

  // ── layout (scene coords) ──
  const CX = 80, CY = 420, CW0 = 920, CW1 = 640, CH = 800;
  const rowY = i => CY + 124 + i * 58;                        // row centre
  const ROWS = [   // [name, level, folder, group (0 UI · 1 API · 2 DB · -1 none), order in group]
    ['app/', 0, 1, -1], ['page.tsx', 1, 0, 0, 0], ['api/notes/route.ts', 1, 0, 1, 0], ['components/', 0, 1, -1], ['NoteList.tsx', 1, 0, 0, 1],
    ['lib/db.ts', 0, 0, 2, 0], ['prisma/', 0, 1, -1], ['schema.prisma', 1, 0, 2, 1], ['middleware.ts', 0, 0, -1], ['package.json', 0, 0, -1],
  ];
  const TAGGED = ROWS.map((r, i) => r[3] >= 0 ? i : -1).filter(i => i >= 0);   // 1 2 4 5 7
  const TAG = ['UI', 'API', 'DB'], DESC = ['screens', 'routes', 'data'];
  const CHECKS = [['entry points', 1], ['storage', 7], ['deps', 9]];
  const BX = 120, BW = 460, BH = 136, BY = [566, 796, 1026];
  const OFF = [{ dx: -16, rot: -2.4 }, { dx: 20, rot: 2.0 }, { dx: -10, rot: -1.6 }];   // hand-sketched, crooked until "fit"
  const ARR_X = 66;
  const LBL = ["fetch('/api/notes')", 'prisma.note.findMany()'];
  const CHIP = { x: TC.x + 24 + 2 * ((TC_W - 48 - 16) / 3 + 8) + (TC_W - 48 - 16) / 6, y: TC.y + 80 + 82 + 34 };   // chip 06 centre
  const MAPC = { x: CX + CW1 / 2, y: CY + CH / 2 };   // (400, 820)
  const GREY = '#8a8780', DIM = '#BDB8AE';
  const MONO = (size, weight = 500) => ({ font: F.mono, weight, size });

  // ── helpers ──
  function mpA(cs, a, fn) { if (a <= 0.002) return; for (const c of cs) { c.save(); c.globalAlpha *= clamp(a); } fn(); for (const c of cs) c.restore(); }
  function mpGlow(T, x, y, r, a) {
    if (a <= 0.003) return;
    const g = T.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,0,0,${Math.min(1, a)})`); g.addColorStop(0.55, `rgba(255,0,0,${Math.min(1, a) * 0.35})`); g.addColorStop(1, 'rgba(255,0,0,0)');
    T.fillStyle = g; T.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const mpIO = u => u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
  const mpBez = (a, c, b, u) => [(1 - u) * (1 - u) * a[0] + 2 * (1 - u) * u * c[0] + u * u * b[0], (1 - u) * (1 - u) * a[1] + 2 * (1 - u) * u * c[1] + u * u * b[1]];
  // polyline helpers: cumulative lengths, partial draw → tip
  function mpCum(pts) { const c = [0]; for (let k = 1; k < pts.length; k++) c.push(c[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1])); return c; }
  function mpTip(pts, cum, u) {
    const L = cum[cum.length - 1] * clamp(u);
    let k = 1; while (k < pts.length - 1 && cum[k] < L) k++;
    const q = clamp((L - cum[k - 1]) / Math.max(1e-6, cum[k] - cum[k - 1]));
    return { p: [lerp(pts[k - 1][0], pts[k][0], q), lerp(pts[k - 1][1], pts[k][1], q)], k, d: [pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]] };
  }
  function mpPoly(ctx, pts, cum, u, col, lw) {
    if (u <= 0) return mpTip(pts, cum, 0);
    const tp = mpTip(pts, cum, u);
    ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(...pts[0]); for (let k = 1; k < tp.k; k++) ctx.lineTo(...pts[k]); ctx.lineTo(...tp.p); ctx.stroke(); ctx.restore();
    return tp;
  }
  // a hand-drawn rectangle (local 0..w, 0..h): overshooting corners + a gentle wobble, as one stroke
  function mpSketchRect(w, h, seed) {
    const r = rng(seed), j = () => (r() - 0.5) * 6;
    const C4 = [[-9 + j(), 2 + j()], [w + 8 + j(), -3 + j()], [w + 1 + j(), h + 8 + j()], [-7 + j(), h + 1 + j()], [2 + j(), -10 + j()]];
    const pts = [];
    for (let e = 0; e < 4; e++) {
      const a = C4[e], b = C4[e + 1], n = 12, ph = r() * TAU, amp = 1.6 + r() * 1.6, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
      for (let s = 0; s < n; s++) { const u = s / n, o = amp * Math.sin(u * Math.PI * 2 + ph) * Math.sin(u * Math.PI); pts.push([lerp(a[0], b[0], u) + nx * o, lerp(a[1], b[1], u) + ny * o]); }
    }
    pts.push(C4[4]);
    return { pts, cum: mpCum(pts) };
  }
  const SK = [0, 1, 2].map(g => [mpSketchRect(BW, BH, 611 + g * 37), mpSketchRect(BW, BH, 733 + g * 41)]);
  // row mess (crooked, misplaced) until scanned
  const MESS = ROWS.map((_, i) => { const r = rng(90 + i * 13); return { dx: (r() - 0.5) * 50, dy: (r() - 0.5) * 12, rot: (r() - 0.5) * 6 }; });
  const scanT = i => SCAN0 + SCAN_D * (i + 0.5) / ROWS.length;
  const scanY = t => lerp(rowY(0) - 34, rowY(ROWS.length - 1) + 34, clamp((t - SCAN0) / SCAN_D));
  const morphP = t => t < MORPH0 ? 0 : clamp(spring(t - MORPH0, 1.9, 0.7), 0, 1.04);
  const cardW = t => lerp(CW0, CW1, morphP(t));
  // tangle: dashed import scribbles between the "?" markers
  const QX = CX + CW0 - 80;
  const TANG = [[1, 7, 610], [2, 4, 700], [4, 7, 590], [5, 1, 760], [7, 2, 640]].map(([a, b, cx], k) => {
    const A = [QX - 28, rowY(a)], B = [QX - 28, rowY(b)], pts = [];
    for (let s = 0; s <= 24; s++) { const u = s / 24, p = mpBez(A, [cx - 120 + k * 30, (A[1] + B[1]) / 2 + (k % 2 ? 60 : -60)], B, u); pts.push(p); }
    return { pts, cum: mpCum(pts), k };
  });

  // ── box transform: crooked until "fit", pulse when the packet hits ──
  function bxXf(g, t) {
    const f = t < FIT + g * 0.035 ? 0 : spring(t - FIT - g * 0.035, 2.6, 0.38);
    const hit = [HIT[g], g === 1 ? PK.b1[1] : g === 0 ? PK.b0[1] : -9];
    let s = 1; for (const h of hit) if (t > h) s += 0.045 * ring(t - h, 4, 10);
    return { dx: OFF[g].dx * (1 - f), rot: OFF[g].rot * (1 - f), s, c: [BX + OFF[g].dx * (1 - f) + BW / 2, BY[g] + BH / 2] };
  }
  function bxPt(g, lx, ly, t) {
    const x = bxXf(g, t), a = x.rot * D2R, rx = (lx - BW / 2) * x.s, ry = (ly - BH / 2) * x.s;
    return [x.c[0] + rx * Math.cos(a) - ry * Math.sin(a), x.c[1] + rx * Math.sin(a) + ry * Math.cos(a)];
  }
  // arrows between boxes (world), sampled for drawing + the packet
  function arrPts(k, t) {
    const A = bxPt(k, ARR_X, BH + 12, t), B = bxPt(k + 1, ARR_X, -14, t), Cc = [(A[0] + B[0]) / 2 + 10, (A[1] + B[1]) / 2], pts = [];
    for (let s = 0; s <= 10; s++) pts.push(mpBez(A, Cc, B, s / 10));
    return { pts, cum: mpCum(pts) };
  }
  // files inside a box: local baseline positions
  const FILE_F = MONO(24, 500), ROW_F = MONO(28, 500);
  function fileLocal(K, g, o) {
    const names = TAGGED.filter(i => ROWS[i][3] === g).map(i => ROWS[i][0]);
    let x = 28; for (let k = 0; k < o; k++) x += measure(K, names[k], FILE_F) + measure(K, ' · ', FILE_F);
    return [x, 108];
  }
  const rowTextX = i => CX + 44 + ROWS[i][1] * 40 + 42;
  const rowP = (t, i) => inAt(t, ROW_T(i), 3.0, 0.52);

  // ── pencil: tip position over its whole run (world, pre stage transform) ──
  function penSeg(t) {
    for (let s = 0; s < PEN.length; s++) if (t < PEN[s][1] || s === PEN.length - 1) return s;
  }
  function segTip(s, t) {
    const [t0, t1, kind, g] = PEN[s], u = mpIO(clamp((t - t0) / (t1 - t0)));
    if (kind === 'box') { const sk = SK[g][0], tp = mpTip(sk.pts, sk.cum, u); return bxPt(g, tp.p[0], tp.p[1], t); }
    const a = arrPts(g, t); return mpTip(a.pts, a.cum, u).p;
  }
  function penPos(t) {
    const s = penSeg(t), [t0] = PEN[s];
    let p = segTip(s, Math.max(t, t0));
    if (s > 0 && t - t0 < 0.035 && t >= t0) { const q = E.outCubic((t - t0) / 0.035); const pe = segTip(s - 1, PEN[s - 1][1]); p = [lerp(pe[0], p[0], q), lerp(pe[1], p[1], q)]; }
    if (t < PEN[0][0]) { const q = E.outCubic(clamp((t - PEN_IN) / (PEN[0][0] - PEN_IN))); p = [lerp(900, p[0], q), lerp(540, p[1], q)]; }
    if (t > PEN_OUT) { const q = E.inCubic(clamp((t - PEN_OUT) / 0.12)); p = [lerp(p[0], 820, q), lerp(p[1], 980, q)]; }
    return p;
  }
  function mpPencil(K, x, y, a) {
    X([K], x, y, 0.95, 32, () => {
      K.globalAlpha *= a;
      K.beginPath(); K.moveTo(0, 0); K.lineTo(-11, -30); K.lineTo(11, -30); K.closePath(); K.fillStyle = '#F1E3C8'; K.fill(); K.strokeStyle = C.ink; K.lineWidth = 3; K.lineJoin = 'round'; K.stroke();
      K.beginPath(); K.moveTo(0, 0); K.lineTo(-4, -11); K.lineTo(4, -11); K.closePath(); K.fillStyle = C.ink; K.fill();
      fillRR(K, -13, -176, 26, 148, 6, C.red); strokeRR(K, -13, -176, 26, 148, 6, C.ink, 3);
      line(K, -4, -170, -4, -36, 'rgba(255,255,255,0.45)', 3);
      fillRR(K, -13, -200, 26, 30, 5, '#E9E4DA'); strokeRR(K, -13, -200, 26, 30, 5, C.ink, 3);
    });
  }

  // ── packet position (world) ──
  function packet(t) {
    const run = (k, w0, w1, back) => { const a = arrPts(k, t), u = E.inOutCubic(clamp((t - w0) / (w1 - w0))); return mpTip(a.pts, a.cum, back ? 1 - u : u).p; };
    if (t >= PK.a0[0] - 0.03 && t < PK.a0[1]) return { p: run(0, ...PK.a0), red: 1 };
    if (t >= PK.a0[1] && t < PK.a1[1]) return { p: run(1, ...PK.a1), red: 1, hide: t < PK.a1[0] };
    if (t >= PK.a1[1] && t < PK.b0[1] + 0.02) return t < PK.b1[1] ? { p: run(1, ...PK.b1, true), red: 0, hide: t < PK.b1[0] } : { p: run(0, ...PK.b0, true), red: 0, hide: t < PK.b0[0] };
    return null;
  }

  // ── stage transform: entrance spring from below · final flight into chip 06 ──
  function stageXf(t) {
    if (t < OUT0) {
      const p = inAt(t, CARD_IN, 2.1, 0.62), land = t > CARD_IN + 0.2 ? ring(t - CARD_IN - 0.2, 3, 8) * 0.012 : 0;
      return { piv: [540, 820], pos: [540, 820 + (1 - p) * 1150], s: lerp(0.86, 1, clamp(p)) * (1 + land), r: (1 - p) * 9, a: clamp(p * 4) };
    }
    const e = E.inOutCubic(clamp((t - OUT0) / (OUT1 - OUT0)));
    return { piv: [MAPC.x, MAPC.y], pos: mpBez([MAPC.x, MAPC.y], [MAPC.x - 260, MAPC.y + 420], [CHIP.x, CHIP.y], e), s: lerp(1, 0.07, E.inOutCubic(Math.min(1, e * 1.05))), r: -10 * Math.sin(Math.PI * e), a: 1 - clamp((e - 0.88) / 0.12) };
  }
  function stagePt(t, p) {
    const x = stageXf(t), a = x.r * D2R, rx = (p[0] - x.piv[0]) * x.s, ry = (p[1] - x.piv[1]) * x.s;
    return [x.pos[0] + rx * Math.cos(a) - ry * Math.sin(a), x.pos[1] + rx * Math.sin(a) + ry * Math.cos(a)];
  }

  // ── focus (the presenter's point + camera): blended phase targets, world coords ──
  function focus(t) {
    const cascade = clamp((t - ROW_T(0)) / (ROW_T(9) - ROW_T(0)));
    const fA = [lerp(300, 420, cascade), lerp(rowY(0), rowY(9), E.outQuad(cascade))];
    const qk = clamp((t - Q_T(0) + 0.1) / (Q_T(4) - Q_T(0)), 0, 1) * 4, qi = TAGGED[Math.min(4, Math.floor(qk))], qn = TAGGED[Math.min(4, Math.floor(qk) + 1)], qf = E.inOutCubic(qk % 1);
    const tq = clamp((t - Q_T(0) + 0.1) / 0.2), fQ = [lerp(fA[0], lerp(rowTextX(qi), rowTextX(qn), qf) + 170, tq), lerp(fA[1], lerp(rowY(qi), rowY(qn), qf), tq)];
    const L = [
      [H0 - 0.3, SCAN0 - 0.06, fQ],
      [SCAN0 - 0.06, MORPH0 + 0.1, [330, scanY(t)]],
      [MORPH0 + 0.1, PEN_OUT, penPos(Math.max(t - 0.04, PEN_IN))],
      [PEN_OUT, FIT - 0.04, (() => { const q = packet(t); return q ? q.p : bxPt(t < PK.a1[1] ? 0 : 1, ARR_X, BH / 2, t); })()],
      [FIT - 0.04, OUT0 - 0.02, [MAPC.x - 30, MAPC.y]],
      [OUT0 - 0.02, 99, [CHIP.x, CHIP.y]],
    ];
    let sx = 0, sy = 0, sw = 0;
    for (const [a, b, p] of L) { const w = win(t, a, b, 0.1, 0.1); if (w <= 0) continue; sx += p[0] * w; sy += p[1] * w; sw += w; }
    const p = sw > 0 ? [sx / sw, sy / sw] : [400, 900];
    return t < OUT0 ? stagePt(t, p) : p;
  }

  // ── the card: header, tree rows, footer · morphs into project-map.md ──
  function cardFrame(T, K, t) {
    const w = cardW(t), mp = clamp(morphP(t));
    T.save(); T.shadowColor = 'rgba(0,0,0,0.42)'; T.shadowBlur = 44; T.shadowOffsetY = 24; fillRR(T, CX, CY, w, CH, 28, '#FFFFFF'); T.restore();
    fillRR(T, CX, CY, w, CH, 28, '#FFFFFF');
    fillRR(K, CX, CY, w, CH, 28, '#FFFFFF');
    // header band (tree) → graph paper (map)
    mpA([K], 1 - mp, () => { K.save(); rr(K, CX, CY, w, CH, 28); K.clip(); K.fillStyle = '#F4F2ED'; K.fillRect(CX, CY, w, 92); K.restore(); line(K, CX, CY + 92, CX + w, CY + 92, HAIR, 2, 'butt'); });
    if (mp > 0) mpA([K], mp, () => {
      K.save(); rr(K, CX, CY, w, CH, 28); K.clip(); K.lineWidth = 1.5; K.strokeStyle = '#EEEAE1';
      for (let x = CX + 36; x < CX + w; x += 36) { K.beginPath(); K.moveTo(x, CY + 120); K.lineTo(x, CY + CH); K.stroke(); }
      for (let y = CY + 120; y < CY + CH; y += 36) { K.beginPath(); K.moveTo(CX, y); K.lineTo(CX + w, y); K.stroke(); }
      K.restore(); line(K, CX + 28, CY + 112, CX + w - 28, CY + 112, 'rgba(17,17,17,0.14)', 2, 'butt');
    });
    strokeRR(K, CX, CY, w, CH, 28, 'rgba(17,17,17,0.16)', 2.5);
  }
  function folderIcon(K, x, y, col) {
    K.save(); K.strokeStyle = col; K.lineWidth = 3; K.lineJoin = 'round';
    K.beginPath(); K.moveTo(x, y - 9); K.lineTo(x + 10, y - 9); K.lineTo(x + 14, y - 5); K.lineTo(x + 28, y - 5); K.lineTo(x + 28, y + 12); K.lineTo(x, y + 12); K.closePath(); K.stroke(); K.restore();
  }
  function fileIcon(K, x, y, col) {
    K.save(); K.strokeStyle = col; K.lineWidth = 3; K.lineJoin = 'round';
    K.beginPath(); K.moveTo(x + 3, y - 13); K.lineTo(x + 16, y - 13); K.lineTo(x + 23, y - 6); K.lineTo(x + 23, y + 13); K.lineTo(x + 3, y + 13); K.closePath(); K.stroke();
    line(K, x + 8, y + 1, x + 18, y + 1, col, 2.5); line(K, x + 8, y + 7, x + 15, y + 7, col, 2.5); K.restore();
  }
  function header(T, K, t) {
    const mp = clamp(morphP(t)), w = cardW(t);
    // tree header
    mpA([K], 1 - clamp(mp * 2.5), () => X([K], 0, -mp * 30, 1, 0, () => {
      folderIcon(K, CX + 30, CY + 48, C.ink);
      text(K, '~/notes-app', CX + 74, CY + 58, Object.assign({ color: C.ink, align: 'left' }, MONO(30, 700)));
      const bw = measure(K, 'main', MONO(22)) + 30, bx = CX + 74 + measure(K, '~/notes-app', MONO(30, 700)) + 18;
      strokeRR(K, bx, CY + 30, bw, 38, 19, 'rgba(17,17,17,0.25)', 2); text(K, 'main', bx + bw / 2, CY + 56, Object.assign({ color: GREY }, MONO(22)));
      // status: existing repo → inspecting… (during the scan)
      const ins = t >= SCAN0 - 0.04, f = MONO(22, 700);
      const lab = ins ? 'inspecting' + '...'.slice(0, 1 + Math.floor((t * 8) % 3)) : 'existing repo';
      const pw = measure(K, 'inspecting...', f) + 54, px = CX + w - 28 - pw;
      const pp = ins ? 1 + ring(t - SCAN0 + 0.04, 4, 9) * 0.08 : 1;
      X([K], px + pw / 2, CY + 49, pp, 0, () => {
        fillRR(K, -pw / 2, -20, pw, 40, 20, ins ? C.red : '#E6E2D9');
        circle(K, -pw / 2 + 22, 0, 6, ins ? (Math.floor(t * 10) % 2 ? '#FFFFFF' : 'rgba(255,255,255,0.4)') : GREY);
        text(K, lab, -pw / 2 + 38, 8, Object.assign({ color: ins ? '#FFFFFF' : GREY, align: 'left' }, f));
      });
    }));
    // map header: path types in, ## Main Flow
    if (t > MORPH0 + 0.06) {
      const path = '.learn-mode/project-map.md', n = Math.ceil(path.length * clamp((t - MORPH0 - 0.06) / 0.22));
      const hp = inAt(t, MORPH0 + 0.06, 3, 0.6);
      X([K], 0, (1 - clamp(hp)) * 24, 1, 0, () => mpA([K], clamp(hp * 3), () => {
        fileIcon(K, CX + 28, CY + 48, C.red);
        text(K, path.slice(0, n), CX + 66, CY + 58, Object.assign({ color: C.ink, align: 'left' }, MONO(26, 700)));
        const mf = clamp((t - MORPH0 - 0.22) / 0.1);
        mpA([K], mf, () => {
          text(K, '## Main Flow', CX + 30, CY + 98, Object.assign({ color: GREY, align: 'left' }, MONO(24, 500)));
          text(K, 'sketched by Claude', CX + w - 30, CY + 98, { font: F.serif, italic: true, weight: 400, size: 32, color: C.red, align: 'right' });
        });
      }));
      // saved ✓ on "fit"
      const sp = inAt(t, FIT + 0.04, 3.2, 0.45);
      if (sp > 0) X([K], CX + w - 92, CY + 48, lerp(0.3, 1, sp), (1 - clamp(sp)) * -12, () => mpA([K], clamp(sp * 3), () => {
        fillRR(K, -66, -21, 132, 42, 21, C.ink);
        text(K, 'saved', -10, 8, Object.assign({ color: '#FFFFFF' }, MONO(22, 700)));
        check(K, 42, 0, 20, clamp((t - FIT - 0.1) / 0.14), C.red, 4.5);
      }));
    }
  }
  function footer(T, K, t) {
    const mp = clamp(morphP(t));
    const fp = clamp((t - ROW_T(9) - 0.05) / 0.2) * (1 - clamp(mp * 3));
    if (fp <= 0) return;
    mpA([K], fp, () => {
      const y = CY + CH - 50;
      line(K, CX + 28, y - 44, CX + cardW(t) - 28, y - 44, HAIR, 2, 'butt');
      text(K, 'claude reads', CX + 30, y + 8, Object.assign({ color: GREY, align: 'left' }, MONO(22)));
      let x = CX + 226;
      for (const [nm, ri] of CHECKS) {
        const st = scanT(ri), on = t >= st;
        const bp = on ? 1 + ring(t - st, 4, 9) * 0.25 : 1;
        X([K], x + 15, y, bp, 0, () => { fillRR(K, -15, -15, 30, 30, 8, on ? C.red : '#FFFFFF'); strokeRR(K, -15, -15, 30, 30, 8, on ? C.red : 'rgba(17,17,17,0.3)', 2.5); check(K, 0, 1, 17, clamp((t - st) / 0.12), '#FFFFFF', 4); });
        text(K, nm, x + 40, y + 8, Object.assign({ color: on ? C.ink : GREY, align: 'left' }, MONO(22, on ? 700 : 500)));
        x += 40 + measure(K, nm, MONO(22, 700)) + 34;
      }
    });
  }
  // a role-tag pill centred at 0,0
  const pillW = (K, g) => measure(K, TAG[g], { font: F.grot, weight: 700, size: 28 }) + 48 * 0.9;
  function tagPill(K, g, h, size) {
    const f = { font: F.grot, weight: 700, size }, w = measure(K, TAG[g], f) + h * 0.9;
    fillRR(K, -w / 2, -h / 2, w, h, h / 2, C.red);
    text(K, TAG[g], 0, size * 0.36, Object.assign({ color: '#FFFFFF' }, f));
    return w;
  }
  function rows(T, K, t) {
    const mp = morphP(t);
    ROWS.forEach(([nm, lvl, isDir, g], i) => {
      const p = rowP(t, i); if (p <= 0.001) return;
      const st = scanT(i), sp = t < st ? 0 : spring(t - st, 3.2, 0.42), m = 1 - sp;
      const scanned = t >= st, x0 = CX + 44 + lvl * 40, y0 = rowY(i);
      const ox = (1 - p) * -90 + MESS[i].dx * m, oy = MESS[i].dy * m, rot = MESS[i].rot * m;
      // untagged rows drop away when the card turns into the map
      let fall = 0, fr = 0, fa = 1;
      if (g < 0 && t > MORPH0) { const d = t - MORPH0 - i * 0.012; if (d > 0) { fall = 900 * d * d + 120 * d; fr = (i % 2 ? 1 : -1) * d * 70; fa = 1 - clamp(d / 0.26); } }
      if (fa <= 0) return;
      const col = g < 0 && scanned ? DIM : C.ink;
      const flying = g >= 0 && t >= FLY[g] + ROWS[i][4] * 0.05;
      mpA([K], clamp(p * 3) * fa, () => X([K], x0 + ox, y0 + oy + fall, 1, rot + fr, () => {
        mpA([K], 1 - clamp(mp * 3), () => (isDir ? folderIcon : fileIcon)(K, 0, 0, g >= 0 && scanned ? C.red : col));
        if (!flying) text(K, nm, 42, 10, Object.assign({ color: col, align: 'left' }, ROW_F));
      }));
    });
  }
  // the "?" markers → flip to role tags on scan → tags + files fly into the map boxes
  function tagsAndFiles(T, K, t) {
    const mp = morphP(t);
    TAGGED.forEach((i, k) => {
      const g = ROWS[i][3], o = ROWS[i][4], y = rowY(i), st = scanT(i);
      const qp = inAt(t, Q_T(k), 3.2, 0.42);
      const fs = FLY[g] + o * 0.05, fl = clamp((t - fs) / FLY_D), fe = E.inOutCubic(fl);
      // file name flight (row → box)
      if (t >= fs) {
        const from = [rowTextX(i) + MESS[i].dx * 0, y + 10], tl = fileLocal(K, g, o), to = bxPt(g, tl[0], tl[1], t);
        const px = lerp(from[0], to[0], fe) + Math.sin(Math.PI * fl) * (g === 1 ? 110 : -40), py = lerp(from[1], to[1], fe) - Math.sin(Math.PI * fl) * 30;
        const size = lerp(28, 24, fe), rot = bxXf(g, t).rot * fe;
        X([K], px, py, 1, rot, () => {
          text(K, ROWS[i][0], 0, 0, Object.assign({ color: C.ink, align: 'left' }, MONO(size, 500)));
          if (o > 0 && fe >= 1) text(K, '·', -measure(K, ' · ', FILE_F) / 2, 0, Object.assign({ color: GREY }, FILE_F));
        });
      }
      if (qp <= 0) return;
      // marker / pill position
      const flip = clamp((t - st) / 0.14), sx = Math.abs(Math.cos(Math.PI * flip));
      const tx = CX + cardW(t) - 80, ty = y + MESS[i].dy * (t < st ? 1 : 0);
      const gone = o > 0 ? clamp((t - MORPH0) / 0.1) : 0;   // the duplicate tag pops out; one pill per group flies
      if (o === 0 || gone < 1) {
        let px = tx, py = ty, h = 40, size = 22, a = 1, rot = 0;
        if (t >= fs) {
          const pl = [24 + pillW(K, g) / 2, 46], to = bxPt(g, pl[0], pl[1], t);
          px = lerp(tx, to[0], fe) + Math.sin(Math.PI * fl) * (g === 1 ? 60 : -30); py = lerp(ty, to[1], fe) - Math.sin(Math.PI * fl) * 70; h = lerp(40, 48, fe); size = lerp(22, 28, fe); rot = bxXf(g, t).rot * fe;
        }
        if (o > 0) { px = tx; py = ty; h = 40; size = 22; rot = 0; a = 1; }
        mpA([K], a, () => X([K], px, py, qp * (1 - E.inBack(gone)), rot, () => {
          if (flip < 0.5) {
            K.save(); K.scale(sx, 1);
            circle(K, 0, 0, 22, '#FFFFFF', C.red, 3.5);
            text(K, '?', 0, 12, { font: F.serif, italic: true, weight: 400, size: 40, color: C.red });
            K.restore();
          } else { K.save(); K.scale(Math.max(0.02, sx), 1); tagPill(K, g, h, size); K.restore(); }
        }));
        if (flip > 0 && flip < 1 && t < fs) burst(K, tx, ty, t - st - 0.07, { n: 8, r0: 34, r1: 64, color: C.red, lw: 4, dur: 0.22 });
      }
    });
  }
  function tangle(T, K, t) {
    const fade = 1 - clamp((t - SCAN0 + 0.02) / 0.22);
    if (fade <= 0) return;
    for (const L of TANG) {
      const p = E.outCubic(clamp((t - TANG_T(L.k)) / 0.3)); if (p <= 0) continue;
      K.save(); K.setLineDash([10, 9]); K.lineDashOffset = -t * 40; K.globalAlpha *= fade;
      mpPoly(K, L.pts, L.cum, p, L.k % 2 ? 'rgba(255,59,31,0.75)' : 'rgba(17,17,17,0.42)', 3);
      K.restore();
    }
  }
  function scanBar(T, K, t) {
    const p = (t - SCAN0) / SCAN_D; if (p < -0.05 || p > 1.12) return;
    const y = scanY(t), a = Math.min(clamp((p + 0.05) / 0.1), 1 - clamp((p - 1) / 0.12)), w = cardW(t);
    mpA([K], a, () => {
      const g = K.createLinearGradient(0, y - 90, 0, y); g.addColorStop(0, 'rgba(255,59,31,0)'); g.addColorStop(1, 'rgba(255,59,31,0.16)');
      K.fillStyle = g; K.fillRect(CX + 4, y - 90, w - 8, 90);
      line(K, CX + 10, y, CX + w - 10, y, C.red, 4, 'butt');
      K.save(); K.translate(CX + 10, y); K.rotate(Math.PI / 4); K.fillStyle = C.red; K.fillRect(-8, -8, 16, 16); K.restore();
      K.save(); K.translate(CX + w - 10, y); K.rotate(Math.PI / 4); K.fillStyle = C.red; K.fillRect(-8, -8, 16, 16); K.restore();
    });
  }
  // ── the map: sketched boxes, arrows, labels, packet ──
  function boxes(T, K, t) {
    for (let g = 0; g < 3; g++) {
      const s = PEN.findIndex(q => q[2] === 'box' && q[3] === g), [t0, t1] = PEN[s];
      if (t < t0) continue;
      const u = mpIO(clamp((t - t0) / (t1 - t0))), u2 = mpIO(clamp((t - t0 - 0.05) / (t1 - t0)));
      const x = bxXf(g, t), done = clamp((t - t1 + 0.04) / 0.12);
      X([K], x.c[0], x.c[1], x.s, x.rot, () => {
        K.translate(-BW / 2, -BH / 2);
        if (done > 0) mpA([K], done, () => fillRR(K, 0, 0, BW, BH, 10, '#FBF9F4'));
        mpPoly(K, SK[g][0].pts, SK[g][0].cum, u, C.ink, 4.5);
        mpA([K], 0.4, () => mpPoly(K, SK[g][1].pts, SK[g][1].cum, u2, C.ink, 2.5));
        // descriptor next to the pill
        const dp = clamp((t - t1 + 0.02) / 0.12);
        if (dp > 0) mpA([K], dp, () => text(K, DESC[g], 24 + pillW(K, g) + 16 + (1 - dp) * 12, 58, { font: F.serif, italic: true, weight: 400, size: 38, color: C.ink, align: 'left' }));
        // packet hit flash
        for (const h of [HIT[g], g === 1 ? PK.b1[1] : g === 0 ? PK.b0[1] + 0.0 : -9]) {
          const d = t - h; if (d < 0 || d > 0.35) continue;
          mpA([K], 1 - d / 0.35, () => strokeRR(K, -6, -6, BW + 12, BH + 12, 14, C.red, 5));
        }
      });
    }
  }
  function arrows(T, K, t) {
    for (let k = 0; k < 2; k++) {
      const s = PEN.findIndex(q => q[2] === 'arr' && q[3] === k), [t0, t1] = PEN[s];
      if (t < t0) continue;
      const a = arrPts(k, t), u = mpIO(clamp((t - t0) / (t1 - t0)));
      const tp = mpPoly(K, a.pts, a.cum, u, C.red, 5);
      if (u > 0.8) {
        const q = clamp((u - 0.8) / 0.2), e = a.pts[a.pts.length - 1], d = tp.d, L = Math.hypot(d[0], d[1]) || 1, ux = d[0] / L, uy = d[1] / L, hl = 20 * q;
        line(K, e[0], e[1], e[0] - ux * hl - uy * hl * 0.7, e[1] - uy * hl + ux * hl * 0.7, C.red, 5);
        line(K, e[0], e[1], e[0] - ux * hl + uy * hl * 0.7, e[1] - uy * hl - ux * hl * 0.7, C.red, 5);
      }
      // code label types in next to the arrow
      const lp = clamp((t - LBL_T[k]) / 0.22);
      if (lp > 0) {
        const m = mpBez(a.pts[0], a.pts[5], a.pts[10], 0.5), n = Math.ceil(LBL[k].length * lp);
        text(K, LBL[k].slice(0, n), m[0] + 34, m[1] + 9, Object.assign({ color: C.ink, align: 'left' }, MONO(26, 500)));
        if (lp < 1) fillRR(K, m[0] + 34 + measure(K, LBL[k].slice(0, n), MONO(26, 500)) + 3, m[1] - 14, 13, 28, 2, C.red);
      }
    }
  }
  function packetDraw(T, K, t) {
    const q = packet(t); if (!q || q.hide) return;
    const [x, y] = q.p, col = q.red ? C.red : C.ink;
    circle(K, x, y, 18, null, col, 2.5);
    circle(K, x, y, 11, col);
    // trail
    for (let k = 1; k <= 3; k++) { const q2 = packet(t - k * 0.022); if (q2 && !q2.hide && q2.red === q.red) circle(K, q2.p[0], q2.p[1], 9 - k * 2, col); }
  }

  SC.map = {
    label: '// 06 — the map', bg: 'light',
    cam(t) {
      const env = win(t, H0, OUT0 - 0.24, 0.45, 0.24);
      if (env <= 0) return { x: 0, y: 0, z: 1, r: 0 };
      const f = focus(t), zMap = win(t, MORPH0, FIT, 0.3, 0.3);
      const z = 1 + env * (0.03 + 0.012 * zMap);
      return { x: (f[0] - 540) * (1 - z) + (540 - f[0]) * 0.035 * env, y: (f[1] - 960) * (1 - z) + (820 - f[1]) * 0.03 * env, z, r: 0.004 * Math.sin(t * 1.9) * env };
    },
    draw(T, K, t) {
      // learning-mode card: pulse on "map" and when the map lands in chip 06
      let b = 0;
      if (t > tMap) b += 0.025 * ring(t - tMap, 3.5, 9);
      if (t > OUT1) b += 0.04 * ring(t - OUT1, 4, 11) * clamp((H1 - t) / 0.05);
      const ringOn = (t >= tMap - 0.02 && t < tMap + 0.36) || (t >= OUT1 - 0.02 && t < H1 - 0.02);
      if (b === 0 || t >= H1) learnCard(T, K, TC.x, TC.y, TC.s, { t, focus: ringOn && t < H1 ? 5 : undefined });
      else { const cx = TC.x + TC_W / 2, cy = TC.y + TC_H / 2; X([T, K], cx, cy, 1 + b, 0, () => learnCard(T, K, -TC_W / 2, -TC_H / 2, TC.s, { t, focus: ringOn ? 5 : undefined })); }
      if (t < CARD_IN || t >= OUT1 + 0.01) {
        if (t >= OUT1 && t < H1) { shock(K, CHIP.x, CHIP.y, t - OUT1, { r: 130, color: C.red, lw: 5, dur: 0.11 }); burst(K, CHIP.x, CHIP.y, t - OUT1, { n: 10, r0: 70, r1: 130, color: C.red, lw: 5, dur: 0.11 }); }
        return;
      }
      // focus glow behind the stage
      mpGlow(T, 540, 820, 640, 0.18 * win(t, SCAN0 - 0.1, SCAN0 + SCAN_D, 0.1, 0.2) + 0.3 * (t > FIT ? Math.exp(-(t - FIT) * 4) : 0));
      const x = stageXf(t);
      mpA([T, K], x.a, () => {
        for (const c of [T, K]) { c.save(); c.translate(x.pos[0], x.pos[1]); c.rotate(x.r * D2R); c.scale(x.s, x.s); c.translate(-x.piv[0], -x.piv[1]); }
        cardFrame(T, K, t);
        header(T, K, t);
        tangle(T, K, t);
        rows(T, K, t);
        footer(T, K, t);
        boxes(T, K, t);
        arrows(T, K, t);
        tagsAndFiles(T, K, t);
        scanBar(T, K, t);
        packetDraw(T, K, t);
        if (t > PEN_IN && t < PEN_OUT + 0.18) { const p = penPos(t); mpPencil(K, p[0], p[1], Math.min(clamp((t - PEN_IN) / 0.05), 1 - clamp((t - PEN_OUT - 0.02) / 0.08))); }
        // "fit": snap burst
        if (t > FIT) { burst(K, BX - 30, BY[1] + BH / 2, t - FIT - 0.05, { n: 12, r0: 60, r1: 150, color: C.red, lw: 6, dur: 0.3 }); }
        for (const c of [T, K]) c.restore();
      });
    },
    guy(t) {
      const d = PRESENTER_DOCK, st = { x: d.x, y: d.y, s: d.s };
      if (t < S0) return st;
      const f = focus(t), sh = [d.x - 226 * d.s, d.y - 264 * d.s];
      const ang = clamp(Math.atan2(f[1] - sh[1], -(f[0] - sh[0])) / D2R, -100, 15);
      const pw = win(t, H0 - 0.02, OUT0 + 0.04, 0.2, 0.2);   // lowers on "together" so the landing in chip 06 stays visible
      const o = Object.assign(st, { armL: 'point', armLp: pw, pointAng: ang });
      // right arm: a puzzled half-shrug at the "?" tangle, thumbs-up on "fit"
      const shr = win(t, Q_T(0) - 0.06, SCAN0 - 0.04, 0.14, 0.16), thb = win(t, FIT - 0.08, 99, 0.14, 0.2);
      if (shr > 0) { o.armR = 'shrug'; o.armRp = shr * 0.8; }
      else if (thb > 0) { o.armR = 'thumb'; o.armRp = thb; }
      const lx = clamp((f[0] - 830) / 520, -1, 1) * 0.85, ly = clamp((f[1] - 1480) / 760, -1, 1) * 0.8;
      Object.assign(o, expr(t, [
        [H0, Q_T(0) - 0.05, { brow: 0.5, smile: 0.15 }],
        [Q_T(0) - 0.05, SCAN0 - 0.04, { browTilt: 0.75, smile: -0.25, brow: 0.2 }],
        [SCAN0 - 0.04, MORPH0, { brow: 0.65, smile: 0.3 }],
        [MORPH0, tMap - 0.04, { smile: 0.45, brow: 0.3 }],
        [tMap - 0.04, tHow, { smile: 0.7, brow: 0.8 }],
        [tHow, FIT - 0.06, { smile: 0.45, brow: 0.35 }],
        [FIT - 0.06, OUT0, { smile: 0.95, brow: 0.55 }],
        [FIT + 0.04, FIT + 0.2, { wink: 1 }],
        [OUT0, 99, { smile: 0.6, brow: 0.3 }],
      ]));
      o.lookX = lx; o.lookY = ly; o.headTurn = lx * 0.18 * pw;
      o.headTilt = -5 * win(t, Q_T(0) - 0.05, SCAN0, 0.1, 0.15) + 4 * win(t, MORPH0, tHow, 0.15, 0.15);
      return o;
    },
  };
  kick(FIT + 0.02, 0.5, 0.4);
})();
