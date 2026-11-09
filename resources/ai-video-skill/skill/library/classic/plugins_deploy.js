// ═════════════ 02 · DEPLOY  [13.90 – 21.06] · video B "plug it in" · classic look ═════════════
// NOTE: reference code from a real reel. Word indices (wi(n)) refer to that reel's script; re-cue on your own words.json.
// Through-object left in: powerStrip() (kit) and the ccWindow terminal.
// assets not included: IMG.db_av, IMG.deploy_av (avatars; lookups no-op when missing).
// The strip stays docked. The Deploy plug (▲ avatar on its face) bungee-drops from above, the presenter reaches up and catches it,
// shows it off, then swings his arm down and jams it into socket 2 himself on PLUGIN_DONE[1] (camera leans in, sparks,
// squash, the one kick; meter → 2/4). Power runs up its cable and a black Deploy device drops in and boots: the plugin directory
// card (186,420 installs · 38 skills) compacts into a header, then "Just say deploy my app" is typed into a Claude Code prompt
// and sent; power flows build → deploy → ● live, a ▲ ships along the pipeline, the URL my-app.example.com types in, and on
// "preview or production" a red selector jumps between two environment chips. "without leaving your terminal": a Claude Code
// window rises out of the prompt and replays the whole deploy as terminal lines. The device lifts off; everything is docked.
// Starts and ends in the hand-off state (kit powerStrip at STRIP_DOCK, the presenter at PRESENTER_DOCK). Helpers: plugins_hook.js (ba*).
(() => {
  const T0 = wi(48) - 0.1, T1 = wi(74) - 0.1;               // 13.90 → 21.06
  const DONE = PLUGIN_DONE[1];                               // 15.01: plug seated, PLUGINS 2/4
  const G = BA_DOCK, SX = socketX(1);
  const SEAT = baPt(G, SX, BA_SEAT_Y);                       // seated plug origin (scene)
  // the plug: bungee drop → caught → held up → jammed in by the presenter's hand
  const T_IN = wi(48) - 0.04, T_GRAB = wi(49) + 0.12, T_PUSH = DONE - 0.2;
  const HANG = [612, 1480], ANCH = [650, -520];              // free-hanging origin + the cable's off-frame anchor
  const PS_HOLD = 1.25;
  // power + panel
  const T_PWR = DONE + 0.02, LEAD = 0.3, T_PDROP = DONE + 0.05, T_BOOT = DONE + 0.3, BOOT_D = 0.36;
  const PX = 70, PY = 470, PW = 940, PH = 750;
  const INL = SEAT[0] - PX;
  // content beats
  const T_CMP = wi(54) + 0.05;                               // "Just": header compacts
  const T_BAR = wi(55) + 0.06;                               // "say": prompt bar slides in
  const TYPE = [['deploy ', wi(56) - 0.02, wi(57) - 0.1], ['my ', wi(57) - 0.02, wi(58) - 0.06], ['app', wi(58) - 0.02, wi(59) - 0.06]];
  const T_ENT = wi(59);                                      // "and": ⏎
  const T_BUILD = wi(60) - 0.02, T_BOK = wi(61) - 0.06;      // "Claude": build spins → ✓
  const T_DEP = wi(61) - 0.02, T_SHIP = wi(62), T_DOK = wi(64);   // "ships": deploy, a ▲ ships along the line
  const T_LIVE = wi(65) - 0.02;                              // "live"
  const T_URL = wi(65) + 0.06;                               // URL types in
  const T_PREV = wi(66) - 0.02, T_PROD = wi(68) - 0.02, T_URLF = wi(69) - 0.02;
  const T_TERM = wi(70) - 0.04;                              // "without leaving your terminal"
  const T_TL = [wi(70) + 0.1, wi(71) - 0.02, wi(71) + 0.14];
  const T_TPULSE = wi(73) - 0.2;
  const T_OUT = 20.7, T_END = T1 - 0.04;
  kick(DONE, 0.7, 0.8);
  const DK = { bg: '#0B0B0C', card: '#141416', line: '#2A2A2E', text: '#EDEDED', dim: '#8F8F8F', faint: '#56565C' };

  // ── the presenter (base pose; the plug follows his hand anchor) ──
  const aimAt = t => lerp(-82, -45, E.inOutCubic(P(t, T_PUSH, DONE - T_PUSH - 0.01))) + 2.5 * Math.sin(t * 13) * win(t, T_GRAB + 0.1, T_PUSH, 0.1, 0.05);
  function presenterState(t) {
    if (t < T0 + 0.004 || t >= T_END) return { x: PRESENTER_DOCK.x, y: PRESENTER_DOCK.y, s: PRESENTER_DOCK.s };
    return Object.assign({ x: PRESENTER_DOCK.x, y: PRESENTER_DOCK.y, s: PRESENTER_DOCK.s },
      arms(t, [
        [T_IN + 0.12, DONE + 0.2, 'L', 'point', { pointAng: aimAt(t) }],
        [DONE + 0.28, T_CMP + 0.05, 'R', 'thumb'],
        [T_CMP + 0.12, T_ENT - 0.02, 'R', 'wave', { wave: 0 }],          // "just say it"
        [T_BUILD - 0.04, T_PREV - 0.1, 'L', 'point', { pointAng: -64 }],  // the pipeline
        [T_PREV - 0.04, T_URLF + 0.1, 'LR', 'shrug'],                     // preview or production, either
        [T_TERM, T_OUT, 'L', 'point', { pointAng: -70 }],                 // up at the terminal
      ]),
      expr(t, [
        [T0, T_GRAB, { brow: 0.7, smile: 0.3 }],
        [T_GRAB, T_PUSH, { brow: 0.45, smile: 0.85, browTilt: 0.2 }],
        [T_PUSH, DONE + 0.05, { brow: -0.2, smile: 0.4 }],
        [DONE + 0.05, T_CMP, { brow: 0.9, smile: 1 }],
        [T_CMP, T_ENT, { brow: 0.35, smile: 0.7 }],
        [T_ENT, T_PREV, { brow: 0.8, smile: 0.5 }],
        [T_PREV, T_TERM, { browTilt: 0.35, smile: 0.55 }],
        [T_TERM, T_OUT + 0.1, { brow: 0.4, smile: 0.9 }],
      ]),
      {
        shock: 0.5 * win(t, DONE - 0.02, DONE + 0.22, 0.03, 0.2),
        wink: win(t, T_TPULSE, T_TPULSE + 0.28, 0.06, 0.12),
        headTurn: -0.2 * win(t, T0 + 0.05, DONE + 0.2) - 0.12 * win(t, T_BAR, T_OUT),
        headTilt: -6 * win(t, T_GRAB, T_PUSH) + 4 * win(t, T_PREV, T_TERM),
        lookX: -0.45 * win(t, T0 + 0.05, DONE + 0.2) - 0.35 * win(t, DONE + 0.2, T_OUT),
        lookY: -0.8 * win(t, T0 + 0.05, T_PUSH) + 0.2 * win(t, T_PUSH, DONE + 0.15) - 0.55 * win(t, DONE + 0.15, T_TERM) - 0.2 * win(t, T_TERM, T_OUT),
      });
  }
  const handAt = t => { const a = GUY3D.anchors(guyState(t, Object.assign({ t }, presenterState(t)))); return a.handL; };

  // ── the plug before it is seated (scene coords): { x, y, rot, s } ──
  function plugFree(t) {
    const d = t - T_IN;
    const fall = E.inOutCubic(clamp(d / 0.26)), arr = d - 0.26;           // bungee: fast drop, then a damped yo-yo on the cable
    let x = HANG[0], y = lerp(-460, HANG[1], fall) + (arr > 0 ? 70 * Math.sin(TAU * 2.6 * arr) * Math.exp(-6 * arr) : 0);
    let rot = 7 * Math.sin(TAU * 1.5 * d) * Math.exp(-2.6 * d) * (d > 0 ? 1 : 0);
    let s = PS_HOLD;
    const h = t > T_GRAB - 0.12 ? handAt(t) : null;
    const gk = E.outCubic(P(t, T_GRAB - 0.06, 0.1));
    if (h && gk > 0) {                                        // caught: the plug rides in the presenter's hand
      const hx = h.x + 6, hy = h.y + 56 * PS_HOLD;
      x = lerp(x, hx, gk); y = lerp(y, hy, gk); rot = lerp(rot, (aimAt(t) + 82) * 0.25 - 6, gk);
    }
    const pk = E.inCubic(P(t, DONE - 0.09, 0.09));            // last stretch: straight down into the socket
    if (pk > 0) { x = lerp(x, SEAT[0], E.outCubic(pk)); y = lerp(y, SEAT[1], pk); rot = lerp(rot, 0, pk); }
    s = lerp(PS_HOLD, BA_PS, E.inOutCubic(P(t, T_PUSH, DONE - T_PUSH)));
    return { x, y, rot, s };
  }

  // ── panel position ──
  const liftE = x => { const s2 = 0.6; return (s2 + 1) * x * x * x - s2 * x * x; };
  const panelY = t => lerp(PY - PH - 900, PY, pop(t - T_PDROP, 1.45, 0.76)) - liftE(P(t, T_OUT, 0.32)) * 1800
    + Math.sin((t - T_PDROP) * 2.1) * 5 * win(t, T_PDROP + 0.8, T_OUT, 0.6, 0.1);
  const inletAt = t => [PX + INL, panelY(t) + PH];

  // ── cables ──
  function vCable(t) {
    if (t < DONE) {
      const f = plugFree(t), r = f.rot * D2R, top = [f.x + Math.sin(r) * 110 * f.s, f.y - Math.cos(r) * 110 * f.s];
      const an = ANCH, dx = top[0] - an[0], dy = top[1] - an[1];
      return [top, [top[0] + Math.sin(r) * 200, top[1] - Math.cos(r) * 200], [an[0] + dx * 0.2, an[1] + dy * 0.2], an];
    }
    const a = baPt(G, SX, BA_SEAT_Y - 110 * BA_PS);
    const e = t < T_PDROP ? ANCH : inletAt(t);
    const d = Math.max(40, Math.hypot(e[0] - a[0], e[1] - a[1])), c = Math.min(170, d * 0.4);
    const mine = [a, [a[0] - c * 0.3, a[1] - c], [e[0] + c * 0.3, e[1] + c], e];
    const k = E.inOutCubic(P(t, T_OUT + 0.02, T_END - T_OUT - 0.04));
    return k > 0 ? baLerpP(mine, baKitCab(G, 1), k) : mine;
  }

  // ── panel interior (panel-local) ──
  const mono = (K, s, x, y, o = {}) => text(K, s, x, y, Object.assign({ font: F.mono, weight: 500, size: 22, color: DK.dim, align: 'left' }, o));
  const NODES = [['build', 40], ['deploy', 350], ['live', 660]], NW = 240, NY = 238, NH = 124;
  function nodeState(i, t) {                                 // 0 idle · 1 active · 2 done
    if (i === 0) return t < T_BUILD ? 0 : t < T_BOK ? 1 : 2;
    if (i === 1) return t < T_DEP ? 0 : t < T_DOK ? 1 : 2;
    return t < T_LIVE ? 0 : 2;
  }
  function pipeline(T, K, t, fade) {
    const a0 = pop(t - T_ENT + 0.06, 2.4, 0.62);
    if (a0 <= 0 || fade <= 0) return;
    K.save(); K.globalAlpha *= clamp(a0 * 3) * fade;
    mono(K, '// deploy', 40, NY - 22, { size: 20 });
    // power: prompt bar → build, then along the pipeline
    const bx = NODES[0][1] + NW / 2, upP = E.outCubic(P(t, T_ENT + 0.05, T_BUILD - T_ENT)), by0 = barGeom(t).y;
    const upA = 1 - clamp((t - T_URL + 0.1) / 0.16);             // the feed line retires once the URL takes that space
    K.save(); K.globalAlpha *= upA;
    line(K, bx, by0, bx, NY + NH, DK.line, 4, 'butt');
    if (upP > 0) { line(K, bx, by0, bx, lerp(by0, NY + NH, upP), C.red, 5, 'butt'); if (upP < 1) circle(K, bx, lerp(by0, NY + NH, upP), 9, C.red); }
    K.restore();
    for (let i = 0; i < 2; i++) {
      const x0 = NODES[i][1] + NW, x1 = NODES[i + 1][1], cy = NY + NH / 2;
      line(K, x0, cy, x1, cy, DK.line, 4, 'butt');
      const t0 = i === 0 ? T_BOK : T_SHIP, t1 = i === 0 ? T_DEP : T_LIVE;
      const p = E.inOutCubic(P(t, t0, Math.max(0.08, t1 - t0)));
      if (p > 0) line(K, x0, cy, lerp(x0, x1, p), cy, C.red, 5, 'butt');
      if (p > 0 && p < 1) {
        if (i === 1) {                                        // the ▲ ships along the line
          const sx = lerp(x0, x1, p), s = 1 + 0.25 * Math.sin(p * Math.PI);
          X([K], sx, cy, s, 90, () => { K.beginPath(); K.moveTo(0, -16); K.lineTo(14, 10); K.lineTo(-14, 10); K.closePath(); K.fillStyle = '#FFFFFF'; K.fill(); });
          for (let k = 1; k < 4; k++) line(K, sx - 18 - k * 14, cy + (k - 2) * 7, sx - 30 - k * 14, cy + (k - 2) * 7, `rgba(255,255,255,${0.5 - k * 0.12})`, 3);
        } else circle(K, lerp(x0, x1, p), cy, 9, C.red);
      }
    }
    NODES.forEach(([lab, nx], i) => {
      const st = nodeState(i, t), ap = pop(t - T_ENT - 0.02 - i * 0.07, 2.6, 0.6);
      if (ap <= 0) return;
      X([K], nx + NW / 2, NY + NH / 2 + (1 - clamp(ap, 0, 1.1)) * 40, lerp(0.9, 1, clamp(ap, 0, 1.1)), 0, () => {
        const x = -NW / 2, y = -NH / 2;
        fillRR(K, x, y, NW, NH, 18, DK.card);
        strokeRR(K, x, y, NW, NH, 18, st === 1 ? '#EDEDED' : st === 2 ? (i === 2 ? C.red : '#3C3C42') : DK.line, st ? 2.5 : 2);
        const ic = [x + 50, 0];
        if (st === 0) circle(K, ic[0], ic[1], 16, null, DK.faint, 3);
        else if (st === 1) {                                  // spinner
          K.save(); K.lineWidth = 4; K.strokeStyle = '#EDEDED'; K.lineCap = 'round'; K.beginPath(); K.arc(ic[0], ic[1], 16, t * 9, t * 9 + 4.2); K.stroke(); K.restore();
          if (i === 1) { K.save(); K.translate(ic[0], ic[1] - 3 * Math.sin(t * 16)); K.beginPath(); K.moveTo(0, -7); K.lineTo(6, 4); K.lineTo(-6, 4); K.closePath(); K.fillStyle = '#EDEDED'; K.fill(); K.restore(); }
        } else if (i < 2) {
          const d = t - (i === 0 ? T_BOK : T_DOK);
          const s = d < 0.1 ? lerp(1.6, 1, E.inQuart(clamp(d / 0.1))) : 1 + ring(d - 0.1, 5, 10) * 0.06;
          X([K], ic[0], ic[1], s, 0, () => { circle(K, 0, 0, 18, C.red); check(K, 0, 1, 18, clamp(d / 0.16), '#FFFFFF', 4); });
        } else {                                              // ● live: pulsing red dot
          const d = t - T_LIVE;
          circle(K, ic[0], ic[1], 11 + 1.5 * Math.sin(t * 8), C.red);
          for (let k = 0; k < 2; k++) { const ph = ((d * 1.2 + k * 0.5) % 1); K.save(); K.globalAlpha *= 1 - ph; circle(K, ic[0], ic[1], 11 + 26 * ph, null, C.red, 2.5); K.restore(); }
        }
        text(K, lab, x + 88, 10, { font: F.mono, weight: 700, size: 30, color: st ? '#EDEDED' : DK.faint, align: 'left' });
      });
    });
    K.restore();
  }
  function urlAndChips(T, K, t, fade) {
    const ua = pop(t - T_URL + 0.04, 2.6, 0.6);
    if (ua <= 0 || fade <= 0) return;
    K.save(); K.globalAlpha *= clamp(ua * 3) * fade;
    const y = 394, h = 72, x = 40, w = PW - 80;
    X([K], x + w / 2, y + h / 2, lerp(0.92, 1, clamp(ua, 0, 1.1)), 0, () => {
      fillRR(K, -w / 2, -h / 2, w, h, h / 2, '#1A1A1D'); strokeRR(K, -w / 2, -h / 2, w, h, h / 2, DK.line, 2);
      // lock glyph
      fillRR(K, -w / 2 + 30, -6, 20, 16, 3, DK.dim); K.save(); K.lineWidth = 3; K.strokeStyle = DK.dim; K.beginPath(); K.arc(-w / 2 + 40, -6, 7, Math.PI, 0); K.stroke(); K.restore();
      const url = typedStr('my-app.example.com', t, T_URL, 58), uf = { font: F.mono, weight: 700, size: 32 };
      text(K, url, -w / 2 + 70, 11, Object.assign({ color: '#FFFFFF', align: 'left' }, uf));
      if (url.length < 17) caretAt(K, -w / 2 + 70 + measure(K, url, uf), 11, 32, t, '#FFFFFF');
      // ↗ open
      K.save(); K.lineWidth = 3.5; K.strokeStyle = '#EDEDED'; K.lineCap = 'round'; K.beginPath(); K.moveTo(w / 2 - 50, 12); K.lineTo(w / 2 - 30, -8); K.moveTo(w / 2 - 44, -8); K.lineTo(w / 2 - 30, -8); K.lineTo(w / 2 - 30, 6); K.stroke(); K.restore();
      // "URL": red flash ring
      const fd = t - T_URLF;
      if (fd > 0 && fd < 0.5) { K.save(); K.globalAlpha *= 1 - fd / 0.5; const e = E.outCubic(fd / 0.5) * 14; strokeRR(K, -w / 2 - e, -h / 2 - e, w + 2 * e, h + 2 * e, h / 2 + e, C.red, 4); K.restore(); }
      if (fd > 0) line(K, -w / 2 + 70, 26, -w / 2 + 70 + measure(K, 'my-app.example.com', uf) * E.outCubic(clamp(fd / 0.2)), 26, C.red, 4, 'round');
    });
    // environment chips: a red selector jumps preview → production
    const cy = 526, cf = { font: F.mono, weight: 700, size: 26 };
    const chips = [['preview', T_PREV], ['production', T_PROD]];
    let cx = 40; const pos = [];
    chips.forEach(([lab, t0]) => { const w2 = measure(K, lab, cf) + 104; pos.push([cx, w2, t0]); cx += w2 + 18; });
    const sel = E.inOutCubic(P(t, T_PROD + 0.04, 0.2));
    pos.forEach(([x0, w2, t0], i) => {
      const d = t - t0; if (d <= 0) return;
      const s = d < 0.1 ? lerp(1.5, 1, E.inQuart(d / 0.1)) : 1 + ring(d - 0.1, 5, 10) * 0.05;
      X([K], x0 + w2 / 2, cy, s, 0, () => { fillRR(K, -w2 / 2, -26, w2, 52, 26, '#161618'); strokeRR(K, -w2 / 2, -26, w2, 52, 26, '#3C3C42', 2); });
    });
    if (t > T_PREV + 0.04) {                                  // the selector pill (slides, squashes)
      const a = pos[0], b = pos[1], k = t > T_PROD ? sel : 0;
      const sx = lerp(a[0], b[0], k), sw = lerp(a[1], b[1], k) + Math.sin(k * Math.PI) * 40;
      const ap = clamp(pop(t - T_PREV - 0.04, 3, 0.6), 0, 1.1);
      K.save(); K.globalAlpha *= clamp(ap * 2);
      fillRR(K, sx - Math.sin(k * Math.PI) * 20, cy - 26, sw, 52, 26, C.red);
      K.restore();
    }
    pos.forEach(([x0, w2, t0], i) => {
      const d = t - t0; if (d <= 0) return;
      const on = i === 0 ? (t < T_PROD + 0.14) : t >= T_PROD + 0.14;
      const s = d < 0.1 ? lerp(1.5, 1, E.inQuart(d / 0.1)) : 1 + ring(d - 0.1, 5, 10) * 0.05;
      X([K], x0 + w2 / 2, cy, s, 0, () => {
        circle(K, -w2 / 2 + 28, 0, 7, on ? '#FFFFFF' : C.red);
        text(K, chips[i][0], -w2 / 2 + 46, 9, Object.assign({ color: on ? '#FFFFFF' : '#EDEDED', align: 'left' }, cf));
        K.save(); K.lineWidth = 3; K.strokeStyle = on ? '#FFFFFF' : DK.dim; K.lineCap = 'round'; K.lineJoin = 'round';   // ↗ link
        const ax = w2 / 2 - 34; K.beginPath(); K.moveTo(ax - 7, 8); K.lineTo(ax + 7, -6); K.moveTo(ax - 3, -6); K.lineTo(ax + 7, -6); K.lineTo(ax + 7, 4); K.stroke(); K.restore();
      });
    });
    K.restore();
  }
  // the prompt bar: big and central while "deploy my app" is typed, docks at the bottom on ⏎, then grows into a
  // Claude Code window that replays the deploy ("without leaving your terminal")
  function barGeom(t) {
    const a = pop(t - T_BAR, 2.4, 0.64), dk = E.inOutCubic(P(t, T_ENT + 0.03, 0.26)), grow = clamp(pop(t - T_TERM, 2.0, 0.72), 0, 1.04);
    const x = 40, w = PW - 80, yb = PH - 50;
    let h = lerp(128, 96, dk), y = lerp(392, yb - 96, dk) + (1 - clamp(a, 0, 1.1)) * 90;
    if (grow > 0) { h = lerp(96, yb - 206, grow); y = yb - h; }
    return { a, dk, grow, x, w, h, y, fs: lerp(46, 30, dk) };
  }
  function terminal(T, K, t) {
    const g = barGeom(t);
    if (g.a <= 0) return;
    const { x, w, h, y, fs, grow } = g;
    K.save(); K.globalAlpha *= clamp(g.a * 3);
    const pulse = t > T_TPULSE ? Math.exp(-(t - T_TPULSE) * 4) : 0, sent = t >= T_ENT;
    if (grow < 0.2) mono(K, '// claude code', x + 4, y - 16, { size: 20 });
    fillRR(K, x, y, w, h, 16, '#15161A');
    const typing = t > TYPE[0][1] - 0.1 && !sent;
    strokeRR(K, x, y, w, h, 16, pulse > 0.02 || (sent && t < T_ENT + 0.3) ? C.red : typing ? '#8F9098' : '#3A3B41', 2 + 3 * pulse);
    if (pulse > 0.02) { K.save(); K.globalAlpha *= pulse; const e = (1 - pulse) * 22; strokeRR(K, x - e, y - e, w + 2 * e, h + 2 * e, 16 + e, C.red, 3); K.restore(); }
    K.save(); rr(K, x, y, w, h, 16); K.clip();
    if (grow > 0.02) {                                        // title bar grows in with the window
      K.save(); K.globalAlpha *= clamp(grow * 2);
      K.fillStyle = '#1D1E23'; K.fillRect(x, y, w, 46);
      [0, 1, 2].forEach(i => circle(K, x + 26 + i * 22, y + 23, 7, i === 0 ? C.red : '#4A4C53'));
      text(K, 'claude — ~/my-app', x + w / 2, y + 30, { font: CC.font, weight: 500, size: 19, color: CC.dim });
      K.restore();
    }
    const typed = baTypeSeg(t, TYPE), tf = { font: CC.font, weight: 500, size: fs };
    const lineY = lerp(y + h / 2 + fs * 0.36, y + 46 + 50, clamp(grow));
    const px = x + fs * 0.9;
    text(K, '>', x + fs * 0.62, lineY, { font: CC.font, weight: 700, size: fs, color: sent ? CC.dim : '#EDEDED', align: 'center' });
    text(K, typed, px + fs * 0.3, lineY, Object.assign({ color: sent ? '#C9C9CE' : '#FFFFFF', align: 'left' }, tf));
    if (!sent) caretAt(K, px + fs * 0.3 + measure(K, typed, tf), lineY, fs, t, '#FFFFFF');
    // ⏎ key
    const ed = t - T_ENT;
    if (ed > -0.3 && ed < 0.45 && grow < 0.1) {
      const press = ed > 0 && ed < 0.12 ? 1 : 0, kw = 84, kh = 56, kx = x + w - kw - 22, ky = y + h / 2 - kh / 2;
      K.save(); K.globalAlpha *= clamp((ed + 0.3) / 0.08) * (1 - clamp((ed - 0.25) / 0.2));
      fillRR(K, kx, ky + press * 4, kw, kh, 12, press ? C.red : '#2A2B30'); text(K, '⏎', kx + kw / 2, ky + kh / 2 + 12 + press * 4, { font: F.grot, weight: 700, size: 32, color: '#FFFFFF' });
      K.restore();
    }
    // transcript replays the deploy
    const L = [['✓', CC.ok, 'build'], ['✓', CC.ok, 'deploy'], ['●', C.red, 'live  my-app.example.com']];
    if (grow > 0.3) {                                         // Claude Code's own input box + status line
      const ia = clamp((grow - 0.3) / 0.5), iy = y + h - 34 - 70;
      K.save(); K.globalAlpha *= ia;
      strokeRR(K, x + 22, iy, w - 44, 62, 12, '#44464E', 2);
      text(K, '>', x + 44, iy + 41, { font: CC.font, weight: 700, size: 26, color: CC.dim, align: 'left' });
      caretAt(K, x + 76, iy + 41, 27, t, '#EDEDED');
      text(K, '? for shortcuts', x + 26, y + h - 14, { font: CC.font, weight: 500, size: 18, color: CC.dim, align: 'left' });
      text(K, '● plugins 2/4', x + w - 26, y + h - 14, { font: CC.font, weight: 700, size: 18, color: C.red, align: 'right' });
      K.restore();
    }
    L.forEach(([gl, col, str], i) => {
      const d = t - T_TL[i]; if (d <= 0 || grow <= 0.5) return;
      const ly = y + 46 + 50 + (i + 1) * 58;
      K.save(); K.globalAlpha *= clamp(d / 0.1); K.translate(0, (1 - E.outCubic(clamp(d / 0.18))) * 12);
      text(K, gl, x + 28, ly, { font: CC.font, weight: 700, size: 32, color: col, align: 'left' });
      text(K, typedStr(str, t, T_TL[i], 80), x + 70, ly, { font: CC.font, weight: i === 2 ? 700 : 500, size: 32, color: i === 2 ? '#FFFFFF' : '#C9C9CE', align: 'left' });
      K.restore();
    });
    K.restore();
    K.restore();
  }
  function panelBody(T, K, t) {
    const c = E.inOutCubic(P(t, T_CMP, 0.38));
    baHero(T, K, t, { c, t0: T_BOOT, W: PW, dark: true, img: 'deploy_av', title: 'Deploy', pill: 'official', sub: 'owner/deploy-plugin',
      num: 186420, numLabel: 'installs · 38 skills', cmd: '/plugin install deploy@official-plugins' });
    const fade = 1 - E.inOutCubic(P(t, T_TERM + 0.1, 0.25)) * 0.65;
    pipeline(T, K, t, fade);
    urlAndChips(T, K, t, fade);
    terminal(T, K, t);
  }

  function draw(T, K, t) {
    if (t < T0 + 0.004 || t >= T_END) { baDockStrip(T, K, t); return; }
    const seated = t >= DONE, k = E.inOutCubic(P(t, T_OUT + 0.02, T_END - T_OUT - 0.04));
    const d = t - DONE;
    const g = Object.assign({}, G);
    if (d >= 0) { const q = ring(d, 3.3, 9); g.sy = 1 - 0.08 * q; g.sx = 1 + 0.028 * q; }
    // database cable (kit geometry) + power already flowing through it
    const c0 = baKitCab(g, 0);
    baCabDraw(K, c0, 10);
    baFlow(T, K, c0, t, T0 - 1, { lead: 0.01, r: 3.4, a: win(t, T0 + 0.15, T_OUT, 0.3, 0.3) * 0.9 });
    // deploy cable: behind the presenter once seated (while held it is drawn in front, with the plug)
    const vc = vCable(t);
    if (seated) { baCabDraw(K, vc, 10); baFlow(T, K, vc, t, T_PWR, { lead: LEAD, r: 3.4, a: 1 - k }); }
    // the device
    const py = panelY(t);
    if (t > T_PDROP && py > -PH - 300) {
      const inl = inletAt(t);
      baPanel(T, K, PX, py, PW, PH, { dark: true, led: t > T_PWR + LEAD - 0.04 ? 1 : 0, boot: P(t, T_BOOT, BOOT_D), ix: INL, label: '// plugin', right: 'plugins.example.com' }, (x, y) => {
        K.save(); T.save(); K.translate(x, y); T.translate(x, y);
        panelBody(T, K, t);
        K.restore(); T.restore();
      });
      const hit = t - (T_PWR + LEAD);
      if (hit > 0 && hit < 0.4) { shock(K, inl[0], inl[1], hit, { r: 90, color: C.red, lw: 4, dur: 0.36 }); baGlow(T, inl[0], inl[1] + 20, 120, 60, 0.6 * (1 - hit / 0.4), '255,0,0'); }
    }
    baIn([T, K], g, () => {
      powerStrip(T, K, 0, 0, 1, { t, p: [1, seated ? 1 : 0, 0, 0], cables: false });
      const fa = 1 - E.inOutCubic(P(t, T_OUT, 0.3));
      baBadge(K, socketX(0), BA_SEAT_Y, BA_PS, 'db_av', fa * win(t, T0 + 0.05, T_OUT, 0.25, 0.01));
      if (seated) baBadge(K, SX, BA_SEAT_Y, BA_PS, 'deploy_av', fa);
      const md = t - DONE;
      if (md > 0 && md < 0.5) { shock(K, 90, 78, md, { r: 60, color: C.red, lw: 3, dur: 0.45 }); baGlow(T, 44, 44, 80, 80, 0.6 * (1 - md / 0.5), '255,0,0'); }
    });
    if (seated) { const [ix, iy] = baPt(g, SX, BA_SOCK_Y - 14); baImpact(T, K, ix, iy, d, 1, 2); }
  }
  function front(T, K, t) {                                   // the held plug + its cable sit in front of the presenter's hand
    if (t < T_IN || t >= DONE) return;
    const vc = vCable(t);
    baCabDraw(K, vc, 10);
    const f = plugFree(t);
    // bungee stretch lines while it's dropping fast
    const dd = t - T_IN;
    if (dd > 0.04 && dd < 0.3) for (let i = -1; i <= 1; i++) line(K, f.x + i * 26, f.y - 150 - 60 * (1 - dd / 0.3), f.x + i * 26, f.y - 150 - 60 * (1 - dd / 0.3) - 70, 'rgba(17,17,17,0.25)', 3);
    // catch: a little pop ring at the hand
    const gd = t - T_GRAB;
    if (gd > 0 && gd < 0.3) shock(K, f.x, f.y - 50, gd, { r: 80, color: C.ink, lw: 3, dur: 0.3 });
    baPlug(T, K, f.x, f.y, { s: f.s, rot: f.rot, name: 'deploy', img: 'deploy_av' });
  }

  SC.deploy = {
    label: '// 02 — deploy', bg: 'light',
    // leans in on the socket while the presenter plugs it in (the socket stays put on screen), back to identity well before the cuts
    cam: t => { const z = 1 + 0.09 * win(t, T_GRAB - 0.15, DONE + 0.25, 0.4, 0.45); return { z, x: (SEAT[0] - W / 2) * (1 - z), y: (SEAT[1] - 60 - H / 2) * (1 - z) }; },
    draw, front,
    guy: presenterState,
  };
})();
