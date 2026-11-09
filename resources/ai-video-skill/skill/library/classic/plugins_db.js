// ═════════════ 01 · DATABASE  [3.54 – 13.90] · video B "plug it in" · classic look ═════════════
// NOTE: reference code from a real reel. Word indices (wi(n)) refer to that reel's script; re-cue on your own words.json.
// Through-object left in: powerStrip() (kit) and the ccWindow terminal.
// assets not included: IMG.db_av (org avatar; lookups no-op when missing).
// The strip springs up from the dock to centre stage. The Database plug (org avatar on its face) swings in on its cable like a
// pendulum from off-frame right, overshoots, settles, hovers, cocks back and slams into socket 1 on PLUGIN_DONE[0]
// (strip squash, sparks, red bloom, the one kick; meter → 1/4). Power runs up the cable and the "appliance" at its other end
// drops into frame and boots with a rising power edge: the plugin directory card (104,250 installs · Made by Acme),
// which compacts into a header while a straight red line shoots up into a Postgres-style database ("straight to your database").
// "so it can run SQL, write migrations, generate your types and check your security advisors": four real MCP tools slide in
// as a control panel of toggle switches on a power bus; each flips on with its word, its branch lights, a small result
// appears and the database reacts (query flash, a migration disc drops onto the stack, a types.ts file, a shield).
// "without you ever opening the dashboard": a dashboard window pops in, a cursor heads for it, its screen CRT-powers-off,
// a red X slashes it and it falls away. Then the panel lifts off, the cable relaxes and the strip + the presenter re-dock.
// Starts and ends in the hand-off state (kit powerStrip at STRIP_DOCK, the presenter at PRESENTER_DOCK). Helpers: plugins_hook.js (ba*).
(() => {
  const T0 = wi(13) - 0.1, T1 = wi(48) - 0.1;               // 3.54 → 13.90
  const DONE = PLUGIN_DONE[0];                               // 5.31: plug seated, PLUGINS 1/4
  const STAGE = baG(500, 1522, 1.3);                         // strip at centre-bottom (x 84 – 916, y 1353 – 1522)
  const SX = socketX(0);
  // pendulum swing-in (strip-local): pivot far above the socket, released from 40° off-frame right
  const HOV = 150, LEN = 1250, PIV = [SX, BA_SEAT_Y - HOV - LEN], TH0 = 44, T_SWING = 3.74, OMEGA = TAU / 1.1, DAMP = 1.9;
  const T_ANT = DONE - 0.21, T_DROPP = DONE - 0.1;          // cock back, then slam
  const PS_FLY = BA_PS * 1.9;                               // plug reads bigger while it is "near the camera"
  // power + panel
  const T_PWR = DONE + 0.02, LEAD = 0.32, T_PDROP = DONE + 0.05, T_BOOT = DONE + 0.3, BOOT_D = 0.38;
  const PX = 70, PY = 470, PW = 940, PH = 720;
  const INL = baPt(STAGE, SX, 0)[0] - PX;                    // inlet x (panel-local) sits right above the socket
  // content beats
  const T_CMP = wi(22) + 0.02;                               // "Claude": hero card compacts into a header
  const T_LINE = wi(23) - 0.04;                              // "straight": the red line shoots up
  const T_DB = wi(25) - 0.04;                                // "your database": discs stack in (last one lands on "database")
  const T_MOVE = wi(27) - 0.02;                              // "so": DB slides left, the switch rows slide in
  const T_ROWIN = [0, 1, 2, 3].map(i => T_MOVE + 0.05 + i * 0.075);
  const T_SW = [wi(30), wi(32), wi(34), wi(38)].map(x => x - 0.06);            // run · write · generate · check
  const T_RES = [wi(31) + 0.02, wi(33) + 0.04, wi(36) - 0.04, wi(40) - 0.02];   // SQL · migrations · types · security
  const T_PERF = wi(41);                                     // "advisors" → performance ✓
  const T_MIG = wi(33) + 0.2;                                // migration disc drops onto the stack
  const T_CHASE = T_PERF + 0.2;                              // LED chase once all four are on
  const T_DASH = wi(42) - 0.04, T_CUR = wi(43) - 0.1, T_OFF = wi(45), T_X = T_OFF + 0.13, T_FALL = wi(47) - 0.12;
  const T_OUT = 13.44, T_END = T1 - 0.04;                    // panel lifts off; everything docked by 13.86
  const CORNER = { x: 952, y: 2082, s: 0.64 };               // The presenter while the stage is busy
  kick(DONE, 0.75, 0.85);

  const TOOLS = ['execute_sql', 'apply_migration', 'generate_typescript_types', 'get_advisors'];
  const RES = ['rows returned', 'migration applied', 'types.ts', 'security'];

  // ── strip geometry ──
  const outM = t => E.inOutCubic(P(t, T_OUT + 0.02, T_END - T_OUT - 0.02));
  function geom(t) {
    let g = baLerpG(BA_DOCK, STAGE, clamp(pop(t - T0 - 0.02, 1.8, 0.7), 0, 1.06));
    const d = t - DONE;
    if (d >= 0) { const q = ring(d, 3.3, 9); g.sy = 1 - 0.085 * q; g.sx = 1 + 0.03 * q; g.y += 6 * Math.exp(-8 * d) * Math.sin(TAU * 2 * d); }
    g.y += Math.sin((t - T0) * 2.6) * 4 * win(t, T0 + 0.5, T_OUT, 0.5, 0.2);     // idle float
    const m = outM(t);
    return m > 0 ? baLerpG(g, BA_DOCK, m) : g;
  }
  // ── the plug in flight (strip-local): origin (bottom-centre of the body), rotation, scale ──
  function plugFly(t) {
    const u = t - T_SWING;
    const settle = 1 - E.inOutCubic(P(t, 4.86, 0.28));
    const th = u < 0 ? TH0 : TH0 * Math.exp(-DAMP * u) * Math.cos(OMEGA * u) * settle;
    const dth = u < 0 ? 0 : -TH0 * Math.exp(-DAMP * u) * (DAMP * Math.cos(OMEGA * u) + OMEGA * Math.sin(OMEGA * u)) * settle;
    const lift = 32 * E.outCubic(P(t, T_ANT, 0.1));
    const hover = (HOV + lift) * (1 - E.inCubic(P(t, T_DROPP, DONE - T_DROPP))) + Math.sin(t * 9) * 4 * win(t, 4.8, T_ANT, 0.2, 0.05);
    const r = th * D2R;
    const x = PIV[0] + LEN * Math.sin(r), y = PIV[1] + LEN * Math.cos(r) + (HOV - hover);
    const s = lerp(PS_FLY, BA_PS, E.inOutCubic(P(t, T_DROPP - 0.05, DONE - T_DROPP + 0.05)));
    return { x, y, rot: -th * 1.12 - dth * 0.018, s, th };
  }
  // ── panel position (scene) ──
  const liftE = x => { const s2 = 0.6; return (s2 + 1) * x * x * x - s2 * x * x; };
  const panelY = t => lerp(PY - PH - 860, PY, pop(t - T_PDROP, 1.45, 0.76)) - liftE(P(t, T_OUT, 0.4)) * 1750
    + Math.sin((t - T_PDROP) * 2.2) * 5 * win(t, T_PDROP + 0.8, T_OUT, 0.6, 0.1);
  const inletAt = t => [PX + INL, panelY(t) + PH];

  // ── cable of plug 0 (scene coords) ──
  function cable(t, g) {
    if (t < DONE) {                                           // in flight: from the plug top to the pivot / panel inlet
      const f = plugFly(t), r = f.rot * D2R, top = [f.x + Math.sin(r) * 110 * f.s, f.y - Math.cos(r) * 110 * f.s];
      const a = baPt(g, top[0], top[1]), piv = baPt(g, PIV[0], PIV[1]);
      const dx = a[0] - piv[0], dy = a[1] - piv[1];
      return [a, [a[0] + Math.sin(r) * 190, a[1] - Math.cos(r) * 190], [piv[0] + dx * 0.25, piv[1] + dy * 0.25], piv];
    }
    const a = baPt(g, SX, BA_SEAT_Y - 110 * BA_PS), e = inletAt(t);
    const d = Math.max(40, Math.hypot(e[0] - a[0], e[1] - a[1])), c = Math.min(170, d * 0.4);
    const mine = [a, [a[0] + c * 0.35, a[1] - c], [e[0] - c * 0.35, e[1] + c], e];      // gentle S into the inlet
    const k = E.inOutCubic(P(t, T_OUT + 0.02, T_END - T_OUT - 0.04));
    return k > 0 ? baLerpP(mine, baKitCab(g, 0), k) : mine;
  }

  // ── Postgres-style database: stacked discs; side shading is halftone (T shows through a hole punched in K) ──
  function database(T, K, bx, by, sc, o) {
    const W = 220, RY = 26, DH = 52, GAP = 12;
    X([T, K], bx, by, sc, 0, () => {
      const n = o.n;
      for (let k = 0; k < n; k++) {
        const drop = k === 3 ? o.drop : 0;
        if (k === 3 && o.newA <= 0) continue;
        const yT = -RY - DH - k * (DH + GAP) - drop;
        const side = new Path2D();
        side.moveTo(-W / 2, yT); side.lineTo(-W / 2, yT + DH); side.ellipse(0, yT + DH, W / 2, RY, 0, Math.PI, 0, true);
        side.lineTo(W / 2, yT); side.ellipse(0, yT, W / 2, RY, 0, 0, Math.PI, false); side.closePath();
        const gr = T.createLinearGradient(-W / 2, 0, W / 2, 0);
        gr.addColorStop(0, 'rgba(0,0,0,0.16)'); gr.addColorStop(0.28, 'rgba(0,0,0,0.02)'); gr.addColorStop(1, 'rgba(0,0,0,0.62)');
        T.fillStyle = gr; T.fill(side);
        K.save(); K.globalCompositeOperation = 'destination-out'; K.fill(side); K.restore();
        const hot = o.flash * (k === n - 1 ? 1 : 0.5);
        if (hot > 0) { K.save(); K.fillStyle = `rgba(255,59,31,${0.35 * hot})`; K.fill(side); K.restore(); }
        K.save(); K.lineWidth = 3.5 / sc * sc; K.strokeStyle = C.ink; K.lineJoin = 'round';
        K.beginPath(); K.moveTo(-W / 2, yT); K.lineTo(-W / 2, yT + DH); K.ellipse(0, yT + DH, W / 2, RY, 0, Math.PI, 0, true); K.lineTo(W / 2, yT); K.stroke();
        K.beginPath(); K.ellipse(0, yT, W / 2, RY, 0, 0, TAU); K.fillStyle = hot > 0 ? `rgb(255,${Math.round(255 - 70 * hot)},${Math.round(255 - 80 * hot)})` : '#FFFFFF'; K.fill(); K.stroke();
        K.restore();
        // unit LEDs on the front
        for (let j = 0; j < 3; j++) circle(K, 46 + j * 20, yT + DH * 0.5 + RY * 0.42, 4.5, o.pwr > 0.5 ? (j === 0 || (j === 1 && o.busy) ? C.red : '#F2B8AE') : '#D9D5CC');
      }
      if (o.shield > 0) {                                     // advisors: a red shield with a check lands on the front
        const s = baSlapS(o.shield), yS = -RY - DH - (n - 1) * (DH + GAP) + 22;
        X([K], -44, yS + 40, s, -6, () => {
          K.beginPath(); K.moveTo(0, -30); K.quadraticCurveTo(22, -24, 28, -22); K.quadraticCurveTo(28, 14, 0, 30); K.quadraticCurveTo(-28, 14, -28, -22); K.quadraticCurveTo(-22, -24, 0, -30); K.closePath();
          K.fillStyle = C.red; K.fill(); K.lineWidth = 3; K.strokeStyle = C.ink; K.stroke();
          check(K, 0, 0, 26, clamp((o.shield - 0.08) / 0.2), '#FFFFFF', 5);
        });
      }
    });
  }
  const baSlapS = dt => dt <= 0 ? 0 : dt < 0.11 ? lerp(1.8, 1, E.inQuart(dt / 0.11)) : 1 + ring(dt - 0.11, 5, 10) * 0.06;

  // bat-lever toggle on a small plate; on: 0 → 1 (spring may overshoot)
  function toggle(K, T, x, y, on, lit) {
    fillRR(K, x - 28, y - 40, 56, 80, 14, '#EFECE5'); strokeRR(K, x - 28, y - 40, 56, 80, 14, C.ink, 3);
    [-30, 30].forEach(dy => circle(K, x, y + dy * 0.95, 2.6, '#A8A49B'));
    circle(K, x, y, 13, '#D9D5CC', C.ink, 3);
    const tipY = y + lerp(24, -26, on), tipX = x + 3 * Math.sin(on * Math.PI);
    const w0 = 9, w1 = 5 + 3 * Math.abs(lerp(1, -1, on));
    K.save(); K.lineCap = 'round';
    line(K, x, y, tipX, tipY, C.ink, w0 + 2);
    line(K, x, y, tipX, tipY, '#55534E', w0 - 3);
    K.restore();
    circle(K, tipX, tipY, w1 + 3, C.ink); circle(K, tipX - 2, tipY - 2, 2.2, '#8a8780');
    circle(K, x + 44, y - 26, 7, lit > 0.5 ? C.red : '#D9D5CC', C.ink, 2);
    if (lit > 0) baGlow(T, x + 44, y - 26, 40, 40, 0.45 * lit, '255,0,0');
  }

  // ── the panel interior (panel-local coords via translate) ──
  function panelBody(T, K, t) {
    const mono = (s, x, y, o = {}) => text(K, s, x, y, Object.assign({ font: F.mono, weight: 500, size: 22, color: '#8a8780', align: 'left' }, o));
    const c = E.inOutCubic(P(t, T_CMP, 0.38));
    // hero card → compact header
    baHero(T, K, t, { c, t0: T_BOOT, W: PW, img: 'db_av', title: 'Database', pill: 'official', sub: 'Made by Acme',
      num: 104250, numLabel: 'installs', cmd: '/plugin install database@official-plugins' });

    // ── database + power bus ──
    const mv = E.inOutCubic(P(t, T_MOVE, 0.42));
    const dbx = lerp(INL, 186, mv), dbs = lerp(1.3, 0.84, mv), dby = lerp(506, 572, mv);
    const lp = E.outCubic(P(t, T_LINE, 0.18));               // the straight red line shoots up
    const busTop = lerp(dby + 8, 258, mv);
    const busCol = C.red;
    if (lp > 0) {
      line(K, INL, PH - 20, INL, lerp(PH - 20, dby + 8, lp), busCol, 7, 'round');
      if (lp >= 1 && mv < 1) { const off = ((t - T_LINE) * 300) % 36; K.save(); K.globalAlpha *= 1 - mv; for (let yy = PH - 20 - off; yy > dby + 14; yy -= 36) circle(K, INL, yy, 3, '#FFD2C9'); K.restore(); }
      if (mv > 0) {
        line(K, INL, dby + 10, INL, lerp(dby + 10, busTop, mv), busCol, 7, 'round');
        const brY = dby - 70 * dbs;                           // branch into the database's side
        line(K, INL, brY, lerp(INL, dbx + 110 * dbs, 1), brY, busCol, 6, 'butt');
        circle(K, INL, brY, 7, C.red);
      }
      if (lp < 1 || t - T_LINE < 0.35) burst(K, INL, lerp(PH - 20, dby + 8, lp), t - T_LINE - 0.16, { n: 8, r0: 14, r1: 46, color: C.red, lw: 4, dur: 0.24 });
      // "straight": a taut twang along the line
      const tw2 = Math.exp(-(t - T_LINE - 0.18) * 9) * (t > T_LINE + 0.18 ? 1 : 0);
      if (tw2 > 0.02 && mv <= 0) for (let k = 0; k < 2; k++) line(K, INL + (k ? 9 : -9) * tw2 * Math.sin((t - T_LINE) * 70), PH - 60, INL, dby + 40, `rgba(255,59,31,${0.35 * tw2})`, 3);
    }
    // a dashed ghost of the database waits at the end of the line until the discs land
    const gh = win(t, T_LINE + 0.12, T_DB + 0.2, 0.12, 0.12);
    if (gh > 0) {
      K.save(); K.globalAlpha *= gh * (0.7 + 0.3 * Math.sin(t * 14)); K.setLineDash([10, 9]); K.lineDashOffset = -t * 30;
      K.lineWidth = 3; K.strokeStyle = '#A8A49B';
      const Wd = 220 * dbs / 2, ry = 26 * dbs, top = dby - (26 + 3 * 52 + 2 * 12) * dbs;
      K.beginPath(); K.ellipse(dbx, top + ry, Wd, ry, 0, 0, TAU); K.stroke();
      K.beginPath(); K.moveTo(dbx - Wd, top + ry); K.lineTo(dbx - Wd, dby - ry); K.ellipse(dbx, dby - ry, Wd, ry, 0, Math.PI, 0, true); K.lineTo(dbx + Wd, top + ry); K.stroke();
      K.restore();
    }
    // discs stack in on "database"
    const nIn = [0, 1, 2].filter(k => t >= T_DB + k * 0.1).length;
    if (nIn > 0) {
      const lastD = t - (T_DB + (nIn - 1) * 0.1);
      const migD = t - T_MIG;
      database(T, K, dbx, dby + (1 - clamp(pop(lastD, 3, 0.5), 0, 1.1)) * -30 * (nIn < 3 ? 1 : 0.4), dbs, {
        n: nIn + (migD > 0 ? 1 : 0), drop: migD > 0 ? (1 - clamp(pop(migD, 2.6, 0.45), 0, 1.2)) * 260 : 0, newA: migD > 0 ? 1 : 0,
        pwr: lp, busy: Math.floor(t * 6) % 2, flash: Math.exp(-Math.max(0, t - T_RES[0]) * 5) * (t > T_RES[0] ? 1 : 0) + 0.8 * Math.exp(-Math.max(0, migD - 0.18) * 6) * (migD > 0.18 ? 1 : 0),
        shield: t - T_RES[3] });
      if (migD > 0.16) baPuff(T, dbx - 90 * dbs, dby - 190 * dbs, migD - 0.16, 0.8, -1), baPuff(T, dbx + 90 * dbs, dby - 190 * dbs, migD - 0.16, 0.8, 1);
      mono('// database', lerp(dbx + 22, dbx - 70, mv), lerp(dby + 44, dby + 58, mv), { size: 20, color: '#8a8780', align: 'left' });
    }

    // ── control panel: four tools on the bus ──
    for (let i = 0; i < 4; i++) {
      const a = pop(t - T_ROWIN[i], 2.4, 0.66);
      if (a <= 0) continue;
      const ry = 212 + i * 124, cy = ry + 50, sx = 420 + (1 - clamp(a, 0, 1.1)) * 560;
      const on = clamp(pop(t - T_SW[i], 3.3, 0.42), 0, 1.12), lit = t >= T_SW[i] + 0.05 ? 1 : 0;
      K.save(); K.globalAlpha *= clamp(a * 3);
      // branch from the bus (grey until the switch closes, then power runs across it)
      const bx0 = INL, bx1 = sx - 30;
      line(K, bx0, cy, bx1, cy, '#DDDAD2', 4, 'butt');
      const fl = E.outCubic(P(t, T_SW[i] + 0.04, 0.14));
      if (fl > 0) { line(K, bx0, cy, lerp(bx0, bx1, fl), cy, C.red, 5, 'butt'); if (fl < 1) circle(K, lerp(bx0, bx1, fl), cy, 8, C.red); }
      circle(K, bx0, cy, 6, lit ? C.red : '#CFCBC2');
      // chase: all LEDs blink in sequence once everything is on
      const ch = t > T_CHASE + i * 0.07 && t < T_CHASE + i * 0.07 + 0.12;
      toggle(K, T, sx, cy, on, ch ? 0 : lit);
      // tool name lights up
      const nf2 = { font: F.mono, weight: 700, size: 27 }, nx2 = sx + 72;
      const hl = Math.exp(-Math.max(0, t - T_SW[i]) * 5) * (t > T_SW[i] ? 1 : 0);
      if (hl > 0.02) fillRR(K, nx2 - 8, cy - 40, measure(K, TOOLS[i], nf2) + 16, 38, 8, `rgba(255,59,31,${0.2 * hl})`);
      text(K, TOOLS[i], nx2, cy - 12, Object.assign({ color: lit ? C.ink : '#B3AFA6', align: 'left' }, nf2));
      // result
      const rd = t - T_RES[i];
      if (rd > 0) {
        const rf = { font: F.mono, weight: 500, size: 21 };
        let rx = nx2;
        K.save(); K.globalAlpha *= clamp(rd / 0.08);
        text(K, '↳', rx, cy + 26, Object.assign({ color: '#9A968D', align: 'left' }, rf)); rx += 30;
        if (i === 0) {                                        // tiny result grid
          for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) { const on2 = rd > 0.06 + r * 0.06; fillRR(K, rx + q * 13, cy + 9 + r * 8, 11, 6, 1.5, on2 ? (q === 0 ? C.red : '#8a8780') : '#E6E3DC'); }
          rx += 50;
        }
        if (i === 2) {                                        // file glyph
          const fx = rx, fy = cy + 5;
          K.beginPath(); K.moveTo(fx, fy); K.lineTo(fx + 14, fy); K.lineTo(fx + 20, fy + 6); K.lineTo(fx + 20, fy + 26); K.lineTo(fx, fy + 26); K.closePath();
          K.fillStyle = '#FFFFFF'; K.fill(); K.lineWidth = 2.5; K.strokeStyle = C.ink; K.stroke();
          text(K, 'TS', fx + 10, fy + 21, { font: F.mono, weight: 700, size: 9, color: C.red });
          rx += 30;
        }
        const str = typedStr(RES[i], t, T_RES[i], 44);
        text(K, str, rx, cy + 26, Object.assign({ color: '#55534E', align: 'left' }, rf));
        let ex2 = rx + measure(K, str, rf) + 12;
        if (str.length === RES[i].length) {
          const cd = rd - RES[i].length / 44;
          check(K, ex2 + 10, cy + 19, 20, clamp(cd / 0.14), C.red, 4);
          ex2 += 34;
          if (i === 3 && t > T_PERF) {                         // "advisors": performance joins security
            const pstr = typedStr('performance', t, T_PERF, 44);
            text(K, '·', ex2, cy + 26, Object.assign({ color: '#9A968D', align: 'left' }, rf));
            text(K, pstr, ex2 + 20, cy + 26, Object.assign({ color: '#55534E', align: 'left' }, rf));
            if (pstr.length === 11) check(K, ex2 + 20 + measure(K, pstr, rf) + 22, cy + 19, 20, clamp((t - T_PERF - 0.25) / 0.14), C.red, 4);
          }
        }
        K.restore();
      }
      K.restore();
      // the query / migration packet runs from the switch along the bus into the database
      const pk = i < 2 ? (t - T_SW[i] - 0.12) / 0.26 : -1;
      if (pk > 0 && pk < 1) {
        const brY = dby - 70 * dbs, pts = [[sx - 30, cy], [INL, cy], [INL, brY], [dbx + 110 * dbs, brY]];
        const segL = [0, 1, 2].map(k => Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1])), tot = segL[0] + segL[1] + segL[2];
        let dd = E.inOutCubic(pk) * tot, k = 0; while (k < 2 && dd > segL[k]) { dd -= segL[k]; k++; }
        const q = [lerp(pts[k][0], pts[k + 1][0], dd / segL[k]), lerp(pts[k][1], pts[k + 1][1], dd / segL[k])];
        circle(K, q[0], q[1], 10, C.red); circle(K, q[0], q[1], 4, '#FFE1DA');
      }
    }
  }

  // ── the dashboard you never open ──
  function dashboard(T, K, t) {
    const a = pop(t - T_DASH, 2.3, 0.58);
    if (a <= 0) return;
    const fd = Math.max(0, t - T_FALL);
    const cx = 676 + fd * 330, cy = 900 + (1 - clamp(a, 0, 1.1)) * 140 + 5200 * fd * fd - 300 * fd, rot = 4 + fd * 120;
    if (cy > 2500) return;
    const w = 580, h = 400;
    X([T, K], cx, cy, lerp(0.72, 1, clamp(a, 0, 1.1)), rot, () => {
      K.save(); T.save(); K.globalAlpha *= clamp(a * 3);
      baDotShadow(K, -w / 2, -h / 2, w, h, 18);
      uiCard(T, K, -w / 2, -h / 2, w, h, { r: 18, border: C.ink, lw: 3 });
      // browser chrome
      K.save(); rr(K, -w / 2, -h / 2, w, h, 18); K.clip();
      K.fillStyle = '#EDEAE3'; K.fillRect(-w / 2, -h / 2, w, 46);
      [0, 1, 2].forEach(i => circle(K, -w / 2 + 24 + i * 20, -h / 2 + 23, 6.5, i === 0 ? '#FF6B57' : '#CFCBC2'));
      fillRR(K, -w / 2 + 96, -h / 2 + 10, w - 130, 26, 13, '#FFFFFF');
      text(K, 'dashboard', -w / 2 + 116, -h / 2 + 30, { font: F.mono, weight: 700, size: 19, color: '#55534E', align: 'left' });
      // screen (CRT power-off: collapses to a line, then a dot, then dark)
      const sx0 = -w / 2, sy0 = -h / 2 + 46, sw = w, sh = h - 46, scy = sy0 + sh / 2;
      const off = t - T_OFF;
      if (off > 0) { K.fillStyle = '#16171B'; K.fillRect(sx0, sy0, sw, sh); }
      const vy = off <= 0 ? 1 : Math.max(0.012, 1 - E.inCubic(clamp(off / 0.1))), vx = off <= 0.1 ? 1 : 1 - E.inCubic(clamp((off - 0.1) / 0.09));
      if (vx > 0) {
        K.save(); K.translate(0, scy); K.scale(vx, vy); K.translate(0, -scy);
        if (off > 0) { K.fillStyle = `rgba(255,255,255,${0.35 + 0.65 * clamp(off / 0.1)})`; K.fillRect(sx0, sy0, sw, sh); }
        else {
          K.fillStyle = '#F3F1EC'; K.fillRect(sx0, sy0, 70, sh);
          for (let i = 0; i < 5; i++) fillRR(K, sx0 + 22, sy0 + 22 + i * 40, 26, 26, 7, i === 1 ? '#CFCBC2' : '#DEDAD2');
          fillRR(K, sx0 + 92, sy0 + 20, 170, 16, 8, '#CFCBC2');
          for (let i = 0; i < 3; i++) { fillRR(K, sx0 + 92 + i * 124, sy0 + 50, 112, 62, 10, '#F3F1EC'); fillRR(K, sx0 + 104 + i * 124, sy0 + 66, 54, 10, 5, '#CFCBC2'); fillRR(K, sx0 + 104 + i * 124, sy0 + 86, 80, 14, 6, '#8a8780'); }
          const bars = [0.4, 0.62, 0.5, 0.8, 0.66, 0.9, 0.72, 0.58, 0.84, 0.7];
          bars.forEach((b, i) => fillRR(K, sx0 + 96 + i * 46, sy0 + sh - 24 - 150 * b, 30, 150 * b, 5, i === 5 ? C.ink : '#D6D2C9'));
        }
        K.restore();
      }
      if (off > 0 && off < 0.24) { K.save(); K.globalAlpha *= 1 - off / 0.24; circle(K, 0, scy, 8 * vx + 3, '#FFFFFF'); K.restore(); }
      K.restore();
      // red X slashes across it
      const xa = E.outCubic(P(t, T_X, 0.12)), xb = E.outCubic(P(t, T_X + 0.1, 0.12));
      const m0 = 34;
      if (xa > 0) line(K, -w / 2 + m0, -h / 2 + m0, lerp(-w / 2 + m0, w / 2 - m0, xa), lerp(-h / 2 + m0, h / 2 - m0, xa), C.red, 16, 'round');
      if (xb > 0) line(K, w / 2 - m0, -h / 2 + m0, lerp(w / 2 - m0, -w / 2 + m0, xb), lerp(-h / 2 + m0, h / 2 - m0, xb), C.red, 16, 'round');
      K.restore(); T.restore();
    });
    // the cursor heading for it (never gets to click)
    const cp = E.inOutCubic(P(t, T_CUR, T_OFF - T_CUR));
    if (t > T_CUR && t < T_X + 0.3) {
      const ca = clamp((t - T_CUR) / 0.1) * (1 - clamp((t - T_X) / 0.2));
      K.save(); K.globalAlpha *= ca;
      cursor(K, lerp(1060, 770, cp), lerp(1260, 930, cp) + 6 * Math.sin(t * 20) * (t > T_OFF ? 1 : 0), 0.62, 0);
      K.restore();
    }
  }

  function draw(T, K, t) {
    if (t < T0 + 0.004 || t >= T_END) { baDockStrip(T, K, t); return; }
    const g = geom(t);
    const seated = t >= DONE;
    const k = E.inOutCubic(P(t, T_OUT + 0.02, T_END - T_OUT - 0.04));
    // cable (behind the strip, the label and the panel)
    const cab = cable(t, g);
    if (t >= T_SWING) baCabDraw(K, cab, 10 * g.s);
    if (seated) baFlow(T, K, cab, t, T_PWR, { lead: LEAD, r: 3.4 * g.s, s: g.s, a: 1 - k });
    // the appliance at the other end: drops in along the cable and boots
    const py = panelY(t);
    if (t > T_PDROP && py > -PH - 300) {
      const inl = inletAt(t);
      baPanel(T, K, PX, py, PW, PH, { led: t > T_PWR + LEAD - 0.04 ? 1 : 0, boot: P(t, T_BOOT, BOOT_D), ix: INL, label: '// plugin', right: 'plugins.example.com' }, (x, y) => {
        K.save(); T.save(); K.translate(x, y); T.translate(x, y);
        panelBody(T, K, t);
        K.restore(); T.restore();
      });
      const veil = win(t, T_DASH, T_FALL + 0.05, 0.2, 0.25);           // the panel steps back while the dashboard is up
      if (veil > 0) { K.save(); rr(K, PX, py, PW, PH, 30); K.fillStyle = `rgba(246,245,241,${0.55 * veil})`; K.fill(); K.restore(); }
      // arrival: the lead pulse hits the inlet
      const hit = t - (T_PWR + LEAD);
      if (hit > 0 && hit < 0.4) { shock(K, inl[0], inl[1], hit, { r: 90, color: C.red, lw: 4, dur: 0.36 }); baGlow(T, inl[0], inl[1] + 20, 120, 60, 0.6 * (1 - hit / 0.4), '255,0,0'); }
    }
    // the strip (+ flying plug, seated-plug badge, impact) in strip space
    baIn([T, K], g, () => {
      powerStrip(T, K, 0, 0, 1, { t, p: [seated ? 1 : 0, 0, 0, 0], cables: false });
      if (seated) baBadge(K, SX, BA_SEAT_Y, BA_PS, 'db_av', 1 - E.inOutCubic(P(t, T_OUT, 0.3)));
      else if (t >= T_SWING) {
        const f = plugFly(t);
        // swing trail: two faint speed arcs behind the plug while it is fast
        const fp = plugFly(t - 0.09), dA = (f.th - fp.th) * D2R;
        if (t > T_SWING + 0.05 && Math.abs(dA) > 0.02) {
          const a1 = Math.PI / 2 - f.th * D2R, a0 = Math.PI / 2 - fp.th * D2R;
          K.save(); K.lineCap = 'round';
          for (const [rr0, lw] of [[LEN - 40, 4], [LEN - 95, 3]]) {
            K.strokeStyle = 'rgba(17,17,17,0.22)'; K.lineWidth = lw; K.beginPath();
            K.arc(PIV[0], PIV[1], rr0, a1 + (a0 - a1) * 0.2, a0, a0 < a1); K.stroke();
          }
          K.restore();
        }
        baPlug(T, K, f.x, f.y, { s: f.s, rot: f.rot, name: 'database', img: 'db_av' });
      }
      // meter pops when it ticks to 1/4
      const md = t - DONE;
      if (md > 0 && md < 0.5) { shock(K, 90, 78, md, { r: 60, color: C.red, lw: 3, dur: 0.45 }); baGlow(T, 44, 44, 80, 80, 0.6 * (1 - md / 0.5), '255,0,0'); }
    });
    if (seated) { const [ix, iy] = baPt(g, SX, BA_SOCK_Y - 14); baImpact(T, K, ix, iy, t - DONE, g.s, 1); }
    dashboard(T, K, t);
  }

  SC.db = {
    label: '// 01 — database', bg: 'light',
    cam: t => ({ z: 1 + 0.018 * Math.sin(Math.PI * clamp((t - T0) / (T_END - T0))) }),
    draw,
    guy(t) {
      if (t < T0 + 0.004 || t >= T_END) return { x: PRESENTER_DOCK.x, y: PRESENTER_DOCK.y, s: PRESENTER_DOCK.s };
      const inn = clamp(pop(t - T0 - 0.04, 2.1, 0.8), 0, 1.03), out = E.inOutCubic(P(t, T_OUT + 0.02, T_END - T_OUT - 0.02));
      const k = inn * (1 - out);
      const x = lerp(PRESENTER_DOCK.x, CORNER.x, k), y = lerp(PRESENTER_DOCK.y, CORNER.y, k), s = lerp(PRESENTER_DOCK.s, CORNER.s, k);
      // finger tracks the swinging plug, then the switch being flipped
      const g = geom(t), f = plugFly(Math.min(t, DONE - 0.001)), pw = baPt(g, f.x, f.y - 60);
      const aimPlug = clamp(baAim(x, y, s, 'L', pw[0], pw[1]), -125, -8);
      const cur = T_SW.filter(v => t >= v - 0.1).length - 1, row = Math.max(0, cur);
      const aimRow = clamp(baAim(x, y, s, 'L', PX + 460, PY + 262 + row * 124), -110, -30);
      return Object.assign({ x, y, s },
        arms(t, [
          [3.74, DONE - 0.1, 'L', 'point', { pointAng: aimPlug }],
          [DONE - 0.06, 5.95, 'R', 'fist'],                         // yes!
          [T_CMP - 0.1, T_MOVE, 'L', 'point', { pointAng: clamp(baAim(x, y, s, 'L', PX + INL, PY + 420), -110, -30) }],
          [T_SW[0] - 0.14, T_SW[2] - 0.1, 'L', 'point', { pointAng: aimRow }],
          [T_SW[2] - 0.06, T_PERF + 0.3, 'L', 'thumb'],
          [T_DASH - 0.02, T_FALL, 'R', 'wave', { wave: t * 13 }],     // "no, never"
        ]),
        expr(t, [
          [T0, DONE - 0.08, { brow: 0.55, smile: 0.35 }],
          [DONE - 0.06, 6.1, { brow: 0.95, smile: 1 }],
          [6.1, T_MOVE, { brow: 0.35, smile: 0.6 }],
          [T_MOVE, T_SW[2], { brow: 0.6, smile: 0.45, browTilt: 0.15 }],
          [T_SW[2], T_DASH, { brow: 0.4, smile: 0.9 }],
          [T_DASH, T_FALL, { browTilt: 0.45, smile: 0.1, brow: -0.25 }],
          [T_FALL, T_OUT + 0.2, { smile: 0.85, brow: 0.3 }],
        ]),
        {
          shock: 0.55 * win(t, DONE - 0.02, DONE + 0.22, 0.03, 0.2),
          wink: win(t, T_FALL + 0.02, T_FALL + 0.3, 0.06, 0.12),
          headTurn: -0.18 * win(t, T0 + 0.1, T_OUT) + 0.12 * Math.sin(t * 17) * win(t, T_DASH, T_OFF, 0.1, 0.1),
          headTilt: -5 * win(t, 3.8, DONE) + 5 * win(t, T_SW[2], T_DASH),
          lookX: -0.55 * win(t, T0 + 0.1, T_OUT),
          lookY: -0.65 * win(t, T0 + 0.1, T_DASH) - 0.35 * win(t, T_DASH, T_OUT),
        });
    },
  };
})();
