// ═════════════ 03 · AGENT-CREW  [wi(74)−0.1 ≈ 21.06 → wi(105)−0.1 ≈ 29.91] · classic look · video B "plug it in" ═════════════
// NOTE: reference code from a real reel. Word indices (wi(n)) refer to that reel's script; re-cue on your own words.json.
// Through-object left in: powerStrip() (kit). Defines BB, the shared helper object used by plugins_tools.js and plugins_cta.js.
// assets not included: IMG.crew_char, IMG.db_av, IMG.deploy_av, IMG.tools_av (lookups no-op when missing).
// owner/agent-crew (31.7K ★, MIT, v2.1.0, 19 specialized agents, /team). Beats:
//   dock → the strip lifts to centre stage → the agent-crew plug swings in on its cable, hovers, SLAMS in on PLUGIN_DONE[2]
//   (squash, sparks, kick, LED 3/4) → a pulse climbs the cable and powers up its README card (radial power-on from where the cable
//   enters) → "turns Claude": the mascot hero collapses into one agent at the hub → "crew of 19": power splits into 19 branches,
//   each lights an agent badge → "type team": the hub opens into a Claude Code prompt, /team typed, ⏎ → the crew regroups into a
//   4-station circuit (plan → build → verify → fix) and a baton of power runs the loop; "together" lights all of it →
//   the card powers down into its cable, back to the dock.
// Also defines BB, the shared "plug it in" helpers used by plugins_crew / plugins_tools / plugins_cta (loaded in that order).
// File-local names are prefixed bb / BB.

var BB = (() => {
  const SY = STRIP_H / 2 + 6, SEAT = SY - 8;                           // socket centre / seated plug bottom (strip space)
  const DOCK = { x: STRIP_DOCK.x, y: STRIP_DOCK.y, s: STRIP_DOCK.s };
  const HERO = { x: 60, y: 1030, s: 1.5 };                             // centre-stage pose for the plug-in moments
  const mixG = (a, b, k) => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), s: lerp(a.s, b.s, k) });
  const cabEnd = i => [socketX(i) + 60 + i * 30, -900];                // same cable end as kit_b's powerStrip
  const cabCtl = (i, ax, ay) => { const [x1, y1] = cabEnd(i); return [[ax, ay], [ax, ay - 160], [x1, y1 + 220], [x1, y1]]; };
  const bez = (Q, u) => { const v = 1 - u; return [0, 1].map(k => v * v * v * Q[0][k] + 3 * v * v * u * Q[1][k] + 3 * v * u * u * Q[2][k] + u * u * u * Q[3][k]); };
  const seatedY = v => SEAT - (1 - E.outBack(v)) * 260;
  const defP = t => [0, 1, 2, 3].map(i => plugIn(t, i));
  const toScene = (g, lx, ly) => [g.x + lx * g.s, g.y + ly * g.s];

  // impact squash (sq, around the strip's bottom centre) — only when g.sq is non-zero, so the dock call stays the kit's exact call
  function squash(cs, g, fn) {
    const sq = g.sq || 0;
    if (!sq) { fn(); return; }
    const ax = g.x + STRIP_W * g.s / 2, ay = g.y + STRIP_H * g.s;
    for (const c of cs) { c.save(); c.translate(ax, ay); c.scale(1 + sq * 0.5, 1 - sq); c.translate(-ax, -ay); }
    fn();
    for (const c of cs) c.restore();
  }
  const inStrip = (cs, g, fn) => squash(cs, g, () => X(cs, g.x, g.y, g.s, 0, fn));
  // seated plugs' cables alone (identical curves to the kit; nothing else in the strip overlaps them, so splitting is pixel-identical)
  function cables(K, g, p) {
    inStrip([K], g, () => p.forEach((v, i) => { if (v > 0) { const [x1, y1] = cabEnd(i); plugCable(K, socketX(i), seatedY(v) - 110, x1, y1); } }));
  }
  // cables run up and soften out under the headline (K is still empty when a scene's draw() starts, so only cables are erased)
  function fadeTop(K, y0 = 300, y1 = 560) {
    K.save(); K.setTransform(1, 0, 0, 1, 0, 0);
    const sy = y => H - (H - y) * SAFE_S;
    const gr = K.createLinearGradient(0, sy(y0), 0, sy(y1)); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    K.globalCompositeOperation = 'destination-out'; K.fillStyle = gr; K.fillRect(0, 0, W, sy(y1)); K.restore();
  }
  function looseCable(K, g, i, sw) {
    if (!sw) return;
    inStrip([K], g, () => { const a = sw.rot * D2R, [x1, y1] = cabEnd(i); plugCable(K, sw.bx + Math.sin(a) * 110, sw.by - Math.cos(a) * 110, x1, y1); });
  }
  function body(T, K, t, g, p, extra) {
    squash([T, K], g, () => powerStrip(T, K, g.x, g.y, g.s, { t, p, cables: false }));
    if (extra) inStrip([T, K], g, extra);
  }

  // ── repo mascot head (agent-crew's own red pixel-muscle character), cropped once into small canvases ──
  let HEAD = null;
  function crewHead() {
    if (HEAD) return HEAD;
    const im = IMG.crew_char; if (!im || !im.naturalWidth) return null;
    const S = 160, sw = im.naturalWidth, sh = im.naturalHeight;
    const cx = 0.597 * sw, cy = 0.262 * sh, half = 0.235 * sw;
    const mk = f => { const c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d'); if (f) x.filter = f; x.drawImage(im, cx - half, cy - half, half * 2, half * 2, 0, 0, S, S); return c; };
    HEAD = { lit: mk(null), dim: mk('grayscale(1) brightness(0.42) contrast(1.15)') };
    return HEAD;
  }
  // logo disc for plug i (database / deploy / agent-crew mascot / browser-tools)
  function logoDisc(K, i, x, y, r, a = 1) {
    if (a <= 0.01) return;
    K.save(); K.globalAlpha *= a; K.beginPath(); K.arc(x, y, r, 0, TAU); K.clip();
    if (i === 2) { const h = crewHead(); if (h) K.drawImage(h.lit, x - r, y - r, 2 * r, 2 * r); }
    else { const im = IMG[['db_av', 'deploy_av', null, 'tools_av'][i]]; if (im && im.naturalWidth) coverImg(K, im, x - r, y - r, 2 * r, 2 * r, { fy: 0.5 }); }
    K.restore();
    K.save(); K.globalAlpha *= a; circle(K, x, y, r, null, 'rgba(255,255,255,0.28)', 2); K.restore();
  }
  // logo on a plug's face (plug body is −38..38 × −110..0 in plug space, drawn at s 0.62 by the kit)
  function plugFace(K, i, bx, by, rot = 0, a = 1) { X([K], bx, by, 0.62, rot, () => logoDisc(K, i, 0, -37, 21, a)); }
  function faces(K, g, p, which, a = 1) { inStrip([K], g, () => which.forEach(i => { if (p[i] > 0.99) plugFace(K, i, socketX(i), seatedY(p[i]), 0, a); })); }

  // a plug hanging on its own cable (strip space). bx, by = plug bottom centre, rot in degrees
  function loosePlug(T, K, i, bx, by, rot, o = {}) {
    if (o.cable) { const a = rot * D2R, [x1, y1] = cabEnd(i); plugCable(K, bx + Math.sin(a) * 110, by - Math.cos(a) * 110, x1, y1); }
    if (o.glow) glow(T, bx, by + 20, 120, 60, o.glow);
    plugHead(T, K, bx, by, { name: PLUG_NAMES[i], lit: false, s: 0.62, rot });
    plugFace(K, i, bx, by, rot, 1);
  }
  // swing in on the cable (damped pendulum pivoting at the cable's top) → hover → slam, landing exactly on tDone
  function swing(t, i, tDone, o = {}) {
    const lead = o.lead ?? 1.25, tau = t - (tDone - lead);
    if (tau < 0 || t >= tDone) return null;
    const sx = socketX(i), hov = o.hover ?? 150, [px, py] = cabEnd(i);
    const ay0 = SEAT - hov - 110, L = Math.hypot(sx - px, ay0 - py), phi0 = Math.atan2(sx - px, ay0 - py);
    const settle = E.inOutCubic(clamp((tau - 0.5) / 0.42));
    const osc = (o.amp ?? 0.95) * Math.exp(-3.3 * tau) * Math.cos(TAU * 1.08 * tau) * (1 - settle);
    const phi = phi0 + osc, ax = px + Math.sin(phi) * L, ay = py + Math.cos(phi) * L;
    let rot = -osc * 57.3 * 0.8;
    let bx = ax - Math.sin(rot * D2R) * 110, by = ay + Math.cos(rot * D2R) * 110;
    by += Math.sin(tau * 11) * 5 * settle;                               // hover
    const sl = clamp((t - (tDone - 0.11)) / 0.11), d = sl * sl * sl;     // accelerate into the socket
    bx = lerp(bx, sx, d); by = lerp(by, SEAT, d); rot *= 1 - d;
    return { bx, by, rot, hover: settle, sl };
  }
  function impact(t, tDone) {
    const d = t - tDone;
    if (d < 0 || d > 1.2) return { sq: 0, dy: 0 };
    return { sq: 0.11 * ring(d, 4.2, 9), dy: 16 * ring(d, 3.6, 8) };
  }
  // T-layer glow: pure red prints as red halftone dots
  function glow(T, x, y, rx, ry, a, rgb = '255,0,0') {
    if (a <= 0.003) return;
    T.save(); T.translate(x, y); T.scale(1, ry / rx);
    const gr = T.createRadialGradient(0, 0, 0, 0, 0, rx);
    gr.addColorStop(0, `rgba(${rgb},${Math.min(1, a)})`); gr.addColorStop(0.5, `rgba(${rgb},${Math.min(1, a) * 0.42})`); gr.addColorStop(1, `rgba(${rgb},0)`);
    T.fillStyle = gr; T.fillRect(-rx, -rx, rx * 2, rx * 2); T.restore();
  }
  // the same red halftone glow, but printed as crisp dots on K: for glows inside panels, whose white face lives on K and would
  // hide anything on T. Dot pitch ≈ the shader's 5 px screen, lattice turned 45° like the red screen.
  function kdots(K, x, y, rx, ry, a, col = C.red) {
    if (a <= 0.01 || rx < 1 || ry < 1) return;
    const m = K.getTransform(), sc = Math.hypot(m.a, m.b) || 1, cell = 5 / sc, c = Math.SQRT1_2;
    const R = Math.max(rx, ry) * 1.45 / cell, cu = (x + y) * c / cell, cv = (y - x) * c / cell;
    K.save(); K.fillStyle = col; K.beginPath();
    for (let u = Math.floor(cu - R); u <= Math.ceil(cu + R); u++) for (let v = Math.floor(cv - R); v <= Math.ceil(cv + R); v++) {
      const X = (u - v) * c * cell, Y = (u + v) * c * cell, dx = (X - x) / rx, dy = (Y - y) / ry, q2 = dx * dx + dy * dy;
      if (q2 >= 1) continue;
      const q = Math.sqrt(q2);
      let d = clamp(a * (q < 0.5 ? lerp(1, 0.42, q * 2) : lerp(0.42, 0, (q - 0.5) * 2)));
      d = clamp((d - 0.03) / 0.94); d = d * d * (3 - 2 * d);
      if (d < 0.015) continue;
      const r = Math.sqrt(d) * 0.76 * cell;
      K.moveTo(X + r, Y); K.arc(X, Y, r, 0, TAU);
    }
    K.fill(); K.restore();
  }
  // sparks at a socket (strip space)
  function sparks(T, K, x, y, d, seed, k = 1) {
    if (d < 0 || d > 0.6) return;
    glow(T, x, y, 190 * k, 120 * k, 0.95 * Math.exp(-d * 8));
    const r = rng(seed);
    for (let n = 0; n < 16; n++) {
      const side = n % 2 ? 1 : -1, a = -Math.PI / 2 + side * (0.45 + r() * 1.0), v = (380 + r() * 560) * k, life = 0.18 + r() * 0.3;
      if (d > life) continue;
      const q = d / life, at = s => { s = Math.max(0, s); return [x + side * 34 * k + Math.cos(a) * v * s, y + Math.sin(a) * v * s + 1500 * k * s * s]; };
      const [x1, y1] = at(d), [x0, y0] = at(d - 0.035);
      line(K, x0, y0, x1, y1, C.red, (5.5 - 3.5 * q) * k, 'round');
      if (n % 4 === 0) circle(K, x1, y1, 3 * k * (1 - q), C.ink);
    }
    shock(K, x, y, d, { r: 130 * k, color: C.red, lw: 4 * k, dur: 0.36 });
  }
  // a pulse climbing seated cable i (u: 0 = plug, 1 = cable top), strip space
  function pulse(T, K, i, u0, u1, o = {}) {
    u0 = clamp(u0); u1 = clamp(u1);
    if (u1 <= u0) return;
    const Q = cabCtl(i, socketX(i), SEAT - 110), n = 20;
    K.save(); K.lineCap = 'round'; K.strokeStyle = C.red; K.lineWidth = o.lw ?? 6;
    K.beginPath(); for (let k = 0; k <= n; k++) { const [x, y] = bez(Q, lerp(u0, u1, k / n)); k ? K.lineTo(x, y) : K.moveTo(x, y); } K.stroke(); K.restore();
    if (o.head !== false) { const [hx, hy] = bez(Q, u1); glow(T, hx, hy, 80, 80, 0.85); circle(K, hx, hy, 8, '#FFFFFF', C.red, 3.5); }
  }
  // live cable: red dashes flowing up toward the powered panel
  function flow(K, i, t, a = 1) {
    if (a <= 0.01) return;
    const Q = cabCtl(i, socketX(i), SEAT - 110);
    K.save(); K.globalAlpha *= a; K.setLineDash([10, 26]); K.lineDashOffset = -t * 170; K.strokeStyle = C.red; K.lineWidth = 3.5; K.lineCap = 'round';
    K.beginPath(); K.moveTo(...Q[0]); K.bezierCurveTo(...Q[1], ...Q[2], ...Q[3]); K.stroke(); K.restore();
  }
  // scene-space point of cable i where it crosses scene height y (for a strip pose g); used to place a panel's power entry
  function cableAtY(g, i, y) {
    const Q = cabCtl(i, socketX(i), SEAT - 110);
    let best = [0, 0], bd = 1e9;
    for (let k = 0; k <= 200; k++) { const [lx, ly] = bez(Q, k / 200), [sx, sy] = toScene(g, lx, ly); const d = Math.abs(sy - y); if (d < bd) { bd = d; best = [sx, sy, k / 200]; } }
    return best;
  }
  // where a pulse climbing cable i reaches scene height y at strip pose g → { u, x, y }
  function hit(g, i, y) { const [x, yy, u] = cableAtY(g, i, y); return { u, x, y: yy }; }
  // pulse schedule: climbs from the plug (t0) to the hit point (t1), then is absorbed into the panel
  function pulseTo(T, K, i, t, t0, t1, uHit) {
    if (t < t0 || t > t1 + 0.16) return;
    const k = clamp((t - t0) / (t1 - t0)), u1 = uHit * k * k * (3 - 2 * k), u0 = t <= t1 ? u1 - 0.3 : lerp(uHit - 0.3, uHit, (t - t1) / 0.16);
    pulse(T, K, i, Math.max(0, u0), u1, { head: t <= t1 });
  }
  // radial power-on of a panel from (ox, oy): p 0..1; box = [x, y, w, h, r] clips the red wavefront ring
  function powerOn(T, K, p, ox, oy, R, box, fn) {
    if (p <= 0.001) return;
    if (p >= 0.999) { fn(); return; }
    const r = R * p;
    for (const c of [T, K]) { c.save(); c.beginPath(); c.arc(ox, oy, r, 0, TAU); c.clip(); }
    fn();
    for (const c of [T, K]) c.restore();
    K.save(); rr(K, box[0] - 6, box[1] - 6, box[2] + 12, box[3] + 12, box[4] + 6); K.clip();
    circle(K, ox, oy, r, null, C.red, 3 + 9 * (1 - p)); circle(K, ox, oy, Math.max(0, r - 18), null, 'rgba(255,59,31,0.25)', 6);
    K.restore();
    T.save(); rr(T, box[0], box[1], box[2], box[3], box[4]); T.clip(); T.beginPath(); T.arc(ox, oy, r, 0, TAU); T.lineWidth = 40; T.strokeStyle = 'rgba(255,0,0,0.35)'; T.stroke(); T.restore();
  }
  // "unpowered" dashed outline of a panel
  function ghost(K, x, y, w, h, r, a) {
    if (a <= 0.01) return;
    K.save(); K.globalAlpha *= a; K.setLineDash([14, 12]); strokeRR(K, x, y, w, h, r, 'rgba(17,17,17,0.35)', 3); K.restore();
  }
  // GitHub star pill in repoCard's style (right-aligned at xr, centred on cy)
  function starPill(K, xr, cy, label) {
    const sf = { font: F.mono, weight: 700, size: 24 }, sw = measure(K, label, sf) + 74, sx = xr - sw;
    fillRR(K, sx, cy - 24, sw, 48, 10, '#F3F1EC'); strokeRR(K, sx, cy - 24, sw, 48, 10, 'rgba(17,17,17,0.14)', 2);
    text(K, '★', sx + 22, cy + 9, { font: F.grot, weight: 700, size: 26, color: '#E3A008' });
    text(K, label, sx + 44, cy + 9, Object.assign({ color: C.ink, align: 'left' }, sf));
    return sw;
  }
  // pointAng that aims the presenter's arm (side 'L' = screen-left) from the shoulder at a scene point
  function aim(side, th, x, y) {
    const sgn = side === 'R' ? 1 : -1, shx = th.x + sgn * 226 * th.s, shy = th.y - 264 * th.s;
    return clamp(Math.atan2(y - shy, sgn * (x - shx)) / D2R, -112, 30);
  }
  const jab = (t, ts, amp = 9) => ts.reduce((a, t0) => a + Math.sin(Math.PI * clamp((t - t0) / 0.26)) * amp, 0);
  function fade(cs, a, fn) { if (a <= 0.001) return; for (const c of cs) { c.save(); c.globalAlpha *= clamp(a); } fn(); for (const c of cs) c.restore(); }
  const slap = d => d <= 0 ? 0 : d < 0.11 ? lerp(1.7, 1, E.inQuart(d / 0.11)) : 1 + ring(d - 0.11, 5, 10) * 0.05;

  return { kdots, hit, pulseTo, SY, SEAT, DOCK, HERO, mixG, cabEnd, cabCtl, bez, seatedY, defP, toScene, squash, inStrip, cables, fadeTop, looseCable, body, crewHead, logoDisc,
    plugFace, faces, loosePlug, swing, impact, glow, sparks, pulse, flow, cableAtY, powerOn, ghost, starPill, aim, jab, fade, slap };
})();

SC.crew = (() => {
  const S0 = wi(74) - 0.1, S1 = wi(105) - 0.1;          // 21.06 → 29.91
  const I = 2, TD = PLUGIN_DONE[I];                     // 22.36 slam (PLUGINS 3/4)
  const T_HUB = wi(84) - 0.04, T_SPLIT = wi(86);               // "Claude" → one agent · "crew" → 19
  const T_NINE = wi(88), T_SPEC = wi(89), T_AGENTS = wi(90);
  const T_PILL = wi(91) + 0.02, T_TYPE = wi(93) + 0.04, CPS = 12.5, CMD = '/team';
  const T_ENTER = wi(95) - 0.17, T_REG = wi(95) + 0.02;
  const T_ST = [wi(97), wi(98), wi(99), wi(101)];       // plan · build · verify · fix
  const T_TOG = wi(104);                                // "together"
  const T_ON = TD + 0.2, T_OFF = S1 - 0.37;
  kick(TD, 0.7, 0.55);

  // ── strip pose: dock → centre stage for the plug-in → back to the dock once it's in ──
  function stripG(t) {
    const up = pop(t - (S0 + 0.02), 1.5, 0.62), down = E.inOutCubic(P(t, TD + 0.14, 0.52));
    const g = BB.mixG(BB.DOCK, BB.HERO, up * (1 - down));
    const im = BB.impact(t, TD); g.y += im.dy * g.s; g.sq = im.sq;
    return g;
  }
  const pOf = t => { const p = BB.defP(t); if (t < TD) p[I] = 0; return p; };

  // ── the README card = the powered panel ──
  const CARD = { x: 70, y: 440, w: 940, h: 960, r: 24 };
  const EN = { x: 544, y: CARD.y + CARD.h };            // where the cable passes behind the card at the dock
  let HIT = null;                                       // where the pulse reaches the card (strip pose at T_ON) → power-on origin
  const hitPt = () => HIT || (HIT = BB.hit(stripG(T_ON), I, 760));
  const RMAX = 1120;
  const onP = t => t < T_OFF ? E.outCubic(P(t, T_ON, 0.44)) : 1 - E.inCubic(P(t, T_OFF, 0.3));
  const HERO_R = { x: 100, y: 726, w: 880, h: 560 };
  const HUB = { x: 544, y: 1328 };
  // fan: 19 agents on two staggered arcs (outer spokes run between the inner badges)
  const FAN = [...Array(19)].map((_, k) => {
    const a = (-160 + k * 140 / 18) * D2R, outer = k % 2 === 0, rx = outer ? 440 : 292, ry = outer ? 478 : 300;
    return { k, a, outer, x: HUB.x + Math.cos(a) * rx, y: HUB.y + Math.sin(a) * ry, sz: outer ? 74 : 60 };
  });
  const ORDER = FAN.map(f => f).sort((a, b) => Math.abs(a.a + Math.PI / 2) - Math.abs(b.a + Math.PI / 2)).map(f => f.k);
  FAN.forEach(f => { f.rank = ORDER.indexOf(f.k); f.tl = T_SPLIT + f.rank * 0.02; f.ton = f.tl + 0.17; });
  // relay pods on a loop: PLAN (TL) → BUILD (TR) → VERIFY (BR) → FIX (BL)
  const LOOP = { x0: 250, x1: 838, y0: 826, y1: 1140 };
  const PODS = [
    { name: 'plan', x: LOOP.x0, y: LOOP.y0 }, { name: 'build', x: LOOP.x1, y: LOOP.y0 },
    { name: 'verify', x: LOOP.x1, y: LOOP.y1 }, { name: 'fix', x: LOOP.x0, y: LOOP.y1 },
  ];
  const PW = 244, PH = 188, BS = 54;
  // crew → pods: outer-left → plan, outer-right → build, inner-right → verify, inner-left → fix (5 · 5 · 5 · 4 = 19)
  const podOf = f => f.outer ? (f.k <= 8 ? 0 : 1) : (f.k <= 8 ? 3 : 2);
  const slotN = [0, 0, 0, 0];
  FAN.forEach(f => { f.pod = podOf(f); f.slot = slotN[f.pod]++; });
  const slotXY = (pi, s) => { const P0 = PODS[pi]; return s < 3 ? [P0.x - 64 + s * 64, P0.y - 8] : [P0.x - 32 + (s - 3) * 64, P0.y + 56]; };
  // loop path (clockwise from PLAN), distance helpers
  const LP = [[LOOP.x0, LOOP.y0], [LOOP.x1, LOOP.y0], [LOOP.x1, LOOP.y1], [LOOP.x0, LOOP.y1], [LOOP.x0, LOOP.y0]];
  const SEG = LP.slice(1).map((p, k) => Math.hypot(p[0] - LP[k][0], p[1] - LP[k][1]));
  const CUM = SEG.reduce((a, s) => (a.push(a[a.length - 1] + s), a), [0]);   // [0, 600, 924, 1524, 1848]
  const ptAt = d => { d = clamp(d, 0, CUM[4]); let k = 0; while (k < 3 && d > CUM[k + 1]) k++; const u = (d - CUM[k]) / SEG[k]; return [lerp(LP[k][0], LP[k + 1][0], u), lerp(LP[k][1], LP[k + 1][1], u)]; };
  // baton distance: rests at each station on its word, darts to the next
  const BATON = [[T_ST[0], 0], [T_ST[1], CUM[1]], [T_ST[2], CUM[2]], [T_ST[3], CUM[3]], [T_TOG, CUM[4]]];
  function batonD(t) {
    if (t < BATON[0][0]) return -1;
    for (let k = 0; k < 4; k++) {
      const [ta, da] = BATON[k], [tb, db] = BATON[k + 1];
      if (t < tb) { const lead = k === 3 ? 0.4 : Math.min(0.34, (tb - ta) * 0.8); return lerp(da, db, E.inOutCubic(clamp((t - (tb - lead)) / lead))); }
    }
    return CUM[4];
  }

  // ── agent badge: the repo's mascot head, grey when unpowered, red + halftone glow when lit ──
  function badge(T, K, x, y, sz, lit, o = {}) {
    const h = BB.crewHead(), s = o.s ?? 1;
    if (s <= 0.01) return;
    X([T, K], x, y, s, o.rot || 0, () => {
      const w = sz, r = sz * 0.26;
      if (lit > 0) BB.kdots(K, 0, 0, w * 1.05, w * 1.05, 0.55 * lit + (o.flash || 0) * 0.5);
      T.save(); T.shadowColor = 'rgba(0,0,0,0.3)'; T.shadowBlur = 10; T.shadowOffsetY = 5; fillRR(T, -w / 2, -w / 2, w, w, r, '#FFFFFF'); T.restore();
      fillRR(K, -w / 2, -w / 2, w, w, r, '#141416');
      if (h) {
        K.save(); rr(K, -w / 2 + 3, -w / 2 + 3, w - 6, w - 6, r - 2); K.clip();
        K.drawImage(h.dim, -w / 2, -w / 2, w, w);
        if (lit > 0) { K.globalAlpha *= clamp(lit); K.drawImage(h.lit, -w / 2, -w / 2, w, w); }
        K.restore();
      }
      strokeRR(K, -w / 2, -w / 2, w, w, r, lit > 0.5 ? C.red : '#3A3B41', lit > 0.5 ? 3.5 : 2.5);
      if (o.flash > 0) { K.save(); K.globalAlpha *= clamp(o.flash); strokeRR(K, -w / 2 - 6, -w / 2 - 6, w + 12, w + 12, r + 6, C.red, 3); K.restore(); }
    });
  }

  // ── card chrome (header, README tab, typed H1, tagline) via the kit's repoCard, mascot in the avatar slot, 31.7K star pill ──
  function cardFace(T, K, t) {
    const { x, y, w, h } = CARD;
    repoCard(T, K, x, y, w, { t, owner: 'owner', repo: 'agent-crew', title: 'agent-crew', titleT0: T_ON + 0.1, cps: 42,
      tagline: 'Multi-agent orchestration for Claude Code.', lang: 'MIT · v2.1.0', h });
    const hd = BB.crewHead();
    if (hd) { K.save(); K.beginPath(); K.arc(x + 54, y + 50, 24, 0, TAU); K.clip(); K.drawImage(hd.lit, x + 30, y + 26, 48, 48); K.restore(); circle(K, x + 54, y + 50, 24, null, 'rgba(17,17,17,0.14)', 2); }
    const sp = E.outCubic(P(t, T_ON + 0.18, 1.0));
    BB.starPill(K, x + w - 30, y + 50, (39.4 * sp).toFixed(1) + 'K');
  }

  // hero mascot → collapses into a single agent at the hub ("turns Claude…")
  function hero(T, K, t) {
    if (t >= T_SPLIT + 0.16) return;
    const k = pop(t - T_HUB, 1.9, 0.72), q = clamp(k);
    const w = lerp(HERO_R.w, 88, k), hh = lerp(HERO_R.h, 88, k);
    const cx = lerp(HERO_R.x + HERO_R.w / 2, HUB.x, k), cy = lerp(HERO_R.y + HERO_R.h / 2, HUB.y, k) - Math.sin(Math.PI * q) * 60;
    const zoom = lerp(1 + 0.06 * E.outCubic(P(t, T_ON, 1.6)), 2.26, q), fx = lerp(0.5, 0.673, q), fy = lerp(0.16, 0.2, q);
    const pre = t < T_SPLIT ? 1 + 0.06 * Math.max(0, Math.sin((t - (T_SPLIT - 0.3)) * 40)) * clamp((t - (T_SPLIT - 0.3)) / 0.3) : 1;
    const pb = t >= T_SPLIT ? E.inBack(clamp((t - T_SPLIT) / 0.16)) : 0;     // pops into the hub node
    const s = pre * (1 - pb) * (t >= T_SPLIT ? 1 + 0.35 * clamp((t - T_SPLIT) / 0.08) : 1);
    if (s <= 0.01) return;
    X([T, K], cx, cy, s, 0, () => {
      const r = lerp(16, 24, q);
      T.save(); T.shadowColor = 'rgba(0,0,0,0.35)'; T.shadowBlur = 24; T.shadowOffsetY = 12; fillRR(T, -w / 2, -hh / 2, w, hh, r, '#FFFFFF'); T.restore();
      if (q > 0.6) BB.kdots(K, 0, 0, 110, 110, 0.6 * (q - 0.6) / 0.4);
      coverImg(K, IMG.crew_char, -w / 2, -hh / 2, w, hh, { fx, fy, zoom, r });
      strokeRR(K, -w / 2, -hh / 2, w, hh, r, q > 0.6 ? C.red : 'rgba(17,17,17,0.12)', q > 0.6 ? 3.5 : 2);
    });
  }

  // crew fan + hub/pill + relay loop (all inside the card)
  function crew(T, K, t) {
    if (t < T_SPLIT - 0.02) return;
    const reg = t >= T_REG;
    // spokes (behind badges): each branch draws out with its pulse, then carries a live dash flow; retract on regroup
    const spokeA = 1 - E.inCubic(P(t, T_REG, 0.18));
    if (spokeA > 0) BB.fade([K], spokeA, () => {
      for (const f of FAN) {
        const q = clamp((t - f.tl) / 0.17);
        if (q <= 0) continue;
        const ex = lerp(HUB.x, f.x, q), ey = lerp(HUB.y, f.y, q);
        line(K, HUB.x, HUB.y, ex, ey, q < 1 ? C.red : 'rgba(17,17,17,0.28)', q < 1 ? 5 : 3, 'round');
        if (q >= 1) { K.save(); K.setLineDash([8, 22]); K.lineDashOffset = -t * 120 - f.k * 7; line(K, HUB.x, HUB.y, f.x, f.y, C.red, 3, 'round'); K.restore(); }
        if (q < 1) { BB.kdots(K, ex, ey, 44, 44, 0.8); circle(K, ex, ey, 6, '#FFFFFF', C.red, 3); }
        // ⏎ fires a second wave out to everyone
        const e = clamp((t - T_ENTER - 0.02) / 0.15);
        if (e > 0 && e < 1) { const wx = lerp(HUB.x, f.x, e), wy = lerp(HUB.y, f.y, e); line(K, lerp(HUB.x, f.x, Math.max(0, e - 0.3)), lerp(HUB.y, f.y, Math.max(0, e - 0.3)), wx, wy, C.red, 6, 'round'); BB.kdots(K, wx, wy, 40, 40, 0.8); }
      }
    });
    // hub node → Claude Code prompt pill (type /team) → glides into the loop's centre
    hubPill(T, K, t);
    // relay loop (pods + track + baton)
    if (reg) relay(T, K, t);
    // badges: fan (lit as their branch arrives) → fly to their pod slot on regroup
    for (const f of [...FAN].sort((a, b) => a.y - b.y)) {
      const age = t - f.ton;
      if (age < -0.17) continue;
      let x = f.x, y = f.y, sz = f.sz, s = age < 0 ? 0 : pop(age, 3.0, 0.45), lit = clamp(age / 0.06), flash = Math.max(0, 1 - age / 0.35);
      s *= 1 + 0.12 * Math.max(0, Math.sin(Math.PI * clamp((t - (T_SPEC + f.k * 0.02)) / 0.24)));          // "specialized" ripple
      flash = Math.max(flash, 0.9 * Math.max(0, 1 - Math.abs(t - T_AGENTS - 0.05) / 0.16));                 // "agents": all flash
      flash = Math.max(flash, Math.max(0, 1 - Math.abs(t - T_ENTER - 0.18) / 0.14));                       // ⏎ wave hits
      y += Math.sin(t * 3.1 + f.k * 1.3) * 3;
      if (reg) {
        const dl = f.pod * 0.03 + f.slot * 0.012, m = pop(t - T_REG - dl, 2.3, 0.62), mq = clamp(m);
        const [tx, ty] = slotXY(f.pod, f.slot);
        x = lerp(f.x, tx, m); y = lerp(f.y, ty, m) - Math.sin(Math.PI * mq) * 70;
        sz = lerp(f.sz, BS, mq);
        const on = podOn(f.pod, t);
        lit = lerp(1, on, mq); flash = mq < 1 ? 0 : on * Math.max(0, 1 - (t - podT(f.pod, t)) / 0.35);
        s = 1 + (on > 0.5 ? 0.05 * Math.sin(t * 16 + f.slot) * podAct(f.pod, t) : 0);
        const wob = on > 0.5 ? Math.abs(Math.sin(t * 9 + f.slot * 1.7)) * 5 * podAct(f.pod, t) : 0;
        y -= wob;
      }
      badge(T, K, x, y, sz, lit, { s, flash });
    }
    // agent counter
    const nOn = FAN.filter(f => t >= f.ton).length, ca = clamp((t - T_SPLIT) / 0.15) * (1 - E.inCubic(P(t, T_REG, 0.2)));
    if (ca > 0) BB.fade([K], ca, () => {
      const cx = CARD.x + 32, cy = CARD.y + 318;
      const f1 = { font: F.mono, weight: 700, size: 30 }, str = String(nOn).padStart(2, '0');
      fillRR(K, cx, cy - 26, 210, 52, 26, '#15161A');
      circle(K, cx + 28, cy, 8, nOn ? C.red : '#4A4C53');
      text(K, str, cx + 48, cy + 11, Object.assign({ color: '#FFFFFF', align: 'left' }, f1));
      text(K, 'agents', cx + 48 + measure(K, str, f1) + 12, cy + 9, { font: F.mono, weight: 500, size: 22, color: '#A9ABB2', align: 'left' });
      const bump = FAN.reduce((a, f) => a + Math.max(0, 1 - Math.abs(t - f.ton) / 0.05), 0);
      if (bump > 0) strokeRR(K, cx - 3, cy - 29, 216, 58, 29, `rgba(255,59,31,${Math.min(0.9, bump)})`, 3);
    });
  }

  const PILL = { w: 316, h: 66 };
  const LOOPC = { x: (LOOP.x0 + LOOP.x1) / 2, y: (LOOP.y0 + LOOP.y1) / 2 };
  function hubPill(T, K, t) {
    const open = pop(t - T_PILL, 2.4, 0.62), oq = clamp(open);
    const mv = pop(t - T_REG - 0.04, 2.0, 0.7);
    const cx = HUB.x, cy = lerp(HUB.y, LOOPC.y, mv);
    // hub node (before the pill opens)
    const node = clamp((t - T_SPLIT) / 0.08);
    if (oq < 0.3) {
      X([T, K], cx, cy, node * (1 - oq / 0.3), 0, () => {
        BB.kdots(K, 0, 0, 70, 70, 0.55 + 0.25 * Math.sin(t * 9));
        circle(K, 0, 0, 20, '#15161A'); circle(K, 0, 0, 9, C.red); circle(K, 0, 0, 20, null, C.red, 3);
      });
    }
    if (open <= 0.01) return;
    // trunk from the card's power entry up to the pill
    const w = lerp(40, PILL.w, open), h = lerp(40, PILL.h, oq);
    X([T, K], cx, cy, 1, 0, () => {
      T.save(); T.shadowColor = 'rgba(0,0,0,0.4)'; T.shadowBlur = 22; T.shadowOffsetY = 10; fillRR(T, -w / 2, -h / 2, w, h, h / 2, '#FFFFFF'); T.restore();
      fillRR(K, -w / 2, -h / 2, w, h, h / 2, CC.bg);
      const ent = win(t, T_ENTER - 0.02, T_ENTER + 0.12, 0.03, 0.2);
      strokeRR(K, -w / 2, -h / 2, w, h, h / 2, ent > 0 ? C.red : '#44464E', 2.5 + ent * 3);
      if (ent > 0) BB.kdots(K, 0, 0, w * 0.7, 70, 0.7 * ent);
      if (oq < 0.6) return;
      K.save(); rr(K, -w / 2, -h / 2, w, h, h / 2); K.clip();
      const f = { font: CC.font, weight: 700, size: 30 };
      text(K, '>', -w / 2 + 28, 11, Object.assign({ color: CC.dim, align: 'left' }, f));
      const typed = typedStr(CMD, t, T_TYPE, CPS), done = t > T_REG + 0.25;
      const tx = -w / 2 + 60;
      text(K, typed, tx, 11, Object.assign({ color: done ? '#C9CAD0' : CC.text, align: 'left' }, f));
      if (!done) caretAt(K, tx + measure(K, typed, f), 11, 32, t, CC.text);
      // ⏎ key (pressed on enter) → while the relay runs: spinner → ✓ on "together"
      const kx = w / 2 - 44;
      if (!done) {
        const pr = win(t, T_ENTER - 0.04, T_ENTER + 0.06, 0.03, 0.12);
        X([K], kx, 0, 1 - pr * 0.15, 0, () => { fillRR(K, -24, -20, 48, 40, 9, pr > 0 ? C.red : '#2C2E35'); text(K, '⏎', 0, 9, { font: F.grot, weight: 700, size: 24, color: '#FFFFFF' }); });
      } else if (t < T_TOG) {
        text(K, SPIN[Math.floor(t * 12) % SPIN.length], kx, 11, { font: CC.font, weight: 700, size: 30, color: CC.orange });
      } else {
        const d = t - T_TOG;
        X([K], kx, 0, BB.slap(d), 0, () => { circle(K, 0, 0, 19, C.red); iconCheck(K, 1, 1, 22, clamp(d / 0.18), '#FFFFFF'); });
      }
      K.restore();
    });
  }

  // relay stations
  const podT = (pi, t) => T_ST[pi];
  const podOn = (pi, t) => clamp((t - (T_ST[pi] - 0.05)) / 0.08);
  const podAct = (pi, t) => Math.max(win(t, T_ST[pi] - 0.05, (pi < 3 ? T_ST[pi + 1] : T_TOG - 0.2) - 0.1, 0.06, 0.25), win(t, T_TOG - 0.03, S1 + 1, 0.06, 0.2));
  function relay(T, K, t) {
    const d = batonD(t);
    // track: grey trace, drawn in; lit red behind the baton; the whole loop on "together"
    const draw = E.inOutCubic(P(t, T_REG + 0.1, 0.26));
    const trace = (col, lw, upto) => { K.save(); K.lineCap = 'round'; K.lineJoin = 'round'; K.strokeStyle = col; K.lineWidth = lw; K.beginPath(); K.moveTo(...LP[0]); let acc = 0; for (let k = 1; k < 5; k++) { if (acc + SEG[k - 1] <= upto) { K.lineTo(...LP[k]); acc += SEG[k - 1]; } else { const u = (upto - acc) / SEG[k - 1]; K.lineTo(lerp(LP[k - 1][0], LP[k][0], u), lerp(LP[k - 1][1], LP[k][1], u)); break; } } K.stroke(); K.restore(); };
    trace('#DAD6CD', 8, CUM[4] * draw);
    // pill ↔ loop link
    const lk = E.inOutCubic(P(t, T_REG + 0.18, 0.2));
    if (lk > 0) { line(K, LOOPC.x, LOOPC.y + PILL.h / 2, LOOPC.x, lerp(LOOPC.y + PILL.h / 2, LOOP.y1, lk), '#DAD6CD', 8, 'butt'); line(K, LOOPC.x, LOOPC.y - PILL.h / 2, LOOPC.x, lerp(LOOPC.y - PILL.h / 2, LOOP.y0, lk), '#DAD6CD', 8, 'butt'); }
    if (d >= 0) {
      trace(C.red, 8, d);
      const tg = E.outCubic(P(t, T_TOG - 0.02, 0.25));
      if (tg > 0) { trace(C.red, 8, CUM[4]); line(K, LOOPC.x, LOOP.y0, LOOPC.x, LOOP.y1, C.red, 8 * tg, 'butt'); }
      // flowing dashes on the lit part
      K.save(); K.setLineDash([10, 22]); K.lineDashOffset = -t * 160; K.globalAlpha *= 0.9; trace('#FFFFFF', 3, d); K.restore();
    }
    // pods
    PODS.forEach((P0, pi) => {
      const a = pop(t - T_REG - 0.02 - pi * 0.05, 2.6, 0.55);
      if (a <= 0.01) return;
      const on = podOn(pi, t), act = podAct(pi, t), arr = t - T_ST[pi];
      const hit = (arr > 0 ? Math.max(0, 1 - arr / 0.3) : 0) + Math.max(0, 1 - Math.abs(t - T_TOG) / 0.22) * 0.8;
      X([T, K], P0.x, P0.y, a * (1 + 0.06 * hit), 0, () => {
        const x = -PW / 2, y = -PH / 2;
        if (act > 0) BB.kdots(K, 0, 0, PW * 0.78, PH * 0.85, 0.75 * act);
        uiCard(T, K, x, y, PW, PH, { r: 20, shadow: 0.7 });
        if (on > 0) { K.save(); K.globalAlpha *= 0.06 + 0.08 * act; fillRR(K, x, y, PW, PH, 20, C.red); K.restore(); }
        strokeRR(K, x, y, PW, PH, 20, act > 0.4 ? C.red : on > 0.5 ? C.ink : HAIR, act > 0.4 ? 4 : 3);
        text(K, P0.name, x + 22, y + 40, { font: F.mono, weight: 700, size: 29, color: act > 0.4 ? C.red : on > 0.5 ? C.ink : '#8a8780', align: 'left' });
        // status LED → ✓ once the baton has moved on
        const lx = PW / 2 - 28, ly = y + 30;
        const dn = t > (pi < 3 ? T_ST[pi + 1] : T_TOG) - 0.05 && act < 0.5;
        if (dn) { circle(K, lx, ly, 12, C.ink); iconCheck(K, lx + 1, ly + 1, 13, 1, '#FFFFFF'); }
        else { circle(K, lx, ly, 8, on > 0.5 ? C.red : '#D6D2C9'); if (act > 0.5) circle(K, lx, ly, 13 + 3 * Math.sin(t * 14), null, C.red, 2.5); }
        if (hit > 0.05) { K.save(); K.globalAlpha *= clamp(hit); strokeRR(K, x - 8, y - 8, PW + 16, PH + 16, 26, C.red, 3); K.restore(); }
      });
    });
    // the baton of power
    if (d >= 0 && t < T_TOG + 0.3) {
      const [bx, by] = ptAt(d), [px, py] = ptAt(d - 70);
      BB.kdots(K, bx, by, 80, 80, 0.9);
      line(K, px, py, bx, by, 'rgba(255,59,31,0.45)', 14, 'round');
      circle(K, bx, by, 13, '#FFFFFF', C.red, 5);
    }
    if (t >= T_TOG) burst(K, LOOPC.x, LOOPC.y, t - T_TOG, { n: 14, r0: 190, r1: 330, color: C.red, lw: 7, dur: 0.38 });
  }

  function card(T, K, t) {
    if (t < TD) return;
    const p = onP(t);
    if (p <= 0) return;
    const fl = Math.sin(t * 2.2) * 3 * clamp((t - T_ON) / 0.5) * (1 - clamp((t - T_OFF) / 0.1));
    const O = t < T_OFF ? hitPt() : EN;
    X([T, K], 0, fl, 1, 0, () => BB.powerOn(T, K, p, O.x, O.y - fl, RMAX, [CARD.x, CARD.y, CARD.w, CARD.h, CARD.r], () => {
      cardFace(T, K, t);
      K.save(); rr(K, CARD.x, CARD.y, CARD.w, CARD.h, CARD.r); K.clip();
      T.save(); rr(T, CARD.x, CARD.y, CARD.w, CARD.h, CARD.r); T.clip();
      // power entry at the card's bottom edge (where the cable passes behind) + trunk up to the hub
      const tr = E.inOutCubic(P(t, T_SPLIT - 0.08, 0.12));
      if (tr > 0) { line(K, EN.x, EN.y, EN.x, lerp(EN.y, lerp(HUB.y, LOOP.y1, E.inOutCubic(P(t, T_REG + 0.18, 0.2))), tr), '#DAD6CD', 8, 'butt'); }
      circle(K, EN.x, EN.y - 4, 12, t >= T_ON ? C.red : '#C9C5BC');
      hero(T, K, t);
      crew(T, K, t);
      T.restore(); K.restore();
    }));
  }

  return {
    label: '// 03 — agent-crew', bg: 'light',
    cam: t => ({ z: 1 + 0.03 * win(t, S0 + 0.05, TD + 0.35, 0.6, 0.5) }),
    draw(T, K, t) {
      const g = stripG(t), p = pOf(t);
      const sw = BB.swing(t, I, TD);
      BB.cables(K, g, p);
      BB.looseCable(K, g, I, sw);
      // pulse up the plug's cable, then a live flow while the card is powered
      BB.inStrip([T, K], g, () => {
        BB.pulseTo(T, K, I, t, TD + 0.02, T_ON, hitPt().u);
        BB.flow(K, I, t, clamp((t - TD - 0.4) / 0.2) * (1 - clamp((t - T_OFF) / 0.2)));
      });
      BB.fadeTop(K);                                     // cables, pulse and flow soften out under the headline
      card(T, K, t);
      BB.body(T, K, t, g, p, () => {
        if (t < TD && t > TD - 1.3 && Math.floor(t * 5) % 2) circle(K, socketX(I) + 30, BB.SY - 30, 5, 'rgba(255,59,31,0.7)');   // empty socket blinks, waiting
        if (sw) BB.loosePlug(T, K, I, sw.bx, sw.by, sw.rot, { glow: 0.35 * sw.hover });
        if (sw && sw.hover > 0.2) BB.kdots(K, socketX(I), BB.SY, 64, 64, 0.5 * sw.hover * (0.6 + 0.4 * Math.sin(t * 20)));
        if (t >= TD) BB.plugFace(K, I, socketX(I), BB.SEAT, 0, 1);
        BB.sparks(T, K, socketX(I), BB.SY - 40, t - TD, 77, 1);
        if (t >= TD) shock(K, 44, 44, t - TD - 0.04, { r: 60, color: C.red, lw: 4, dur: 0.4 });   // master LED
      });
    },
    guy(t) {
      const th = PRESENTER_DOCK;
      const g = stripG(t), plugS = BB.toScene(g, socketX(I), BB.SEAT - 180);
      const relayAng = () => { const d = batonD(t), [bx, by] = d >= 0 ? ptAt(d) : ptAt(0); return Math.max(-84, BB.aim('L', th, bx, by)); };   // never across his own face
      const A = arms(t, [
        [S0 + 0.1, TD - 0.03, 'L', 'point', { pointAng: -58 + BB.jab(t, [wi(77) - 0.05]) }],                    // up at the strip as the plug swings in
        [TD - 0.02, TD + 0.52, 'LR', 'fist'],                                                               // it's in → double fist pump
        [wi(81) - 0.06, T_HUB + 0.42, 'L', 'shrug'],                                                        // "which turns Claude…" presenting
        [T_SPLIT - 0.12, T_AGENTS - 0.1, 'L', 'point', { pointAng: -62 + BB.jab(t, [T_NINE]) }],            // "crew of 19"
        [T_AGENTS - 0.06, wi(91) + 0.08, 'R', 'thumb'],                                                     // "agents."
        [wi(91) + 0.06, T_REG - 0.06, 'L', 'point', { pointAng: BB.aim('L', th, HUB.x, HUB.y) + BB.jab(t, [wi(94) - 0.02]) }],   // "type team"
        [T_REG + 0.12, T_TOG - 0.16, 'L', 'point', { pointAng: relayAng() + BB.jab(t, T_ST, 7) }],           // follows the baton
        [T_TOG - 0.16, S1 + 0.6, 'R', 'thumb'],                                                              // "together"
      ]);
      const ex = expr(t, [
        [S0, TD - 0.06, { brow: 0.45, smile: 0.35 }],
        [TD - 0.06, TD + 0.16, { shock: 0.5, brow: 0.9 }],
        [TD + 0.12, wi(81), { smile: 0.95, brow: 0.5 }],
        [wi(81), T_SPLIT, { smile: 0.5, brow: 0.3, browTilt: 0.12 }],
        [T_SPLIT, T_AGENTS, { brow: 0.85, smile: 0.55 }],
        [T_AGENTS, wi(91), { smile: 0.9, brow: 0.35 }],
        [wi(91), T_REG, { smile: 0.6, brow: 0.2, browTilt: -0.15 }],
        [T_REG, T_TOG - 0.15, { smile: 0.55, brow: 0.45 }],
        [T_TOG - 0.15, S1 + 0.6, { smile: 1, brow: 0.5 }],
      ]);
      const bd = batonD(t), bx = bd >= 0 ? ptAt(bd)[0] : LOOPC.x;
      return Object.assign({ x: th.x, y: th.y, s: th.s }, A, ex, {
        lookX: -0.3 * win(t, S0 + 0.05, TD + 0.1) - 0.5 * win(t, TD + 0.1, T_PILL) - 0.45 * win(t, T_PILL, T_REG)
          + lerp(-0.75, -0.25, clamp((bx - 244) / 600)) * win(t, T_REG, T_TOG - 0.1) - 0.1 * win(t, T_TOG - 0.1, S1 + 0.5),
        lookY: -0.85 * win(t, S0 + 0.05, TD + 0.05) - 0.3 * win(t, TD + 0.05, T_SPLIT) - 0.55 * win(t, T_SPLIT, T_PILL)
          + 0.05 * win(t, T_PILL, T_REG) - 0.55 * win(t, T_REG, T_TOG - 0.1),
        headTurn: -0.2 * win(t, S0 + 0.05, T_TOG - 0.1),
        headTilt: 5 * win(t, T_AGENTS - 0.05, wi(91)) - 4 * win(t, wi(91), T_REG) + 6 * win(t, T_TOG - 0.1, S1 + 0.5),
        headNod: 0.4 * Math.max(0, Math.sin((t - TD) * 12)) * win(t, TD, TD + 0.5, 0.05, 0.2),
      });
    },
  };
})();
