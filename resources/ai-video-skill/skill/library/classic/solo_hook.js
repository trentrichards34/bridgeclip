// ═════════════ 01 · HOOK  [0 – 2.96] · classic orange · "If you're a solo founder, working harder is the worst thing you can do." ═════════════
// NOTE: reference code from a real reel. Word indices (wi(n)) refer to that reel's script; re-cue on your own words.json.
// Through-object left in: the roster() card (laptop screen morphs into it, hand-off at the end); delete the roster() calls to drop it.
// assets not included: none (all vector drawing).
// Beats: frame 0 the founder's "To-do · today" laptop is already slamming in with tasks streaming in faster than he can tick them,
//   a clock whirls, coffee cups stack into a wobbling tower, notifications pile up · "solo" a red "team of 1" tag swings off the
//   laptop · "working" an EFFORT lever card slides in and creeps up · "harder" the lever slams to MAX (sparks, red glow, the list
//   turbo-scrolls, clock blurs) · "worst" the lever SNAPS off + "NOT THE FIX" stamp (the one kick) · "thing" the pile collapses
//   (cups topple, cards fall behind the presenter, clock rolls off) while the laptop screen morphs into the solo roster card · 2.74+ hand-off.
// helpers are prefixed hk (file-local)
(() => {
  const T1 = wi(14) - 0.1;                                              // cut → jobs (2.96)
  const tSolo = wi(3), tFounder = wi(4), tWork = wi(5), tHarder = wi(6), tWorst = wi(9), tThing = wi(10);
  const tFall = tThing + 0.02, tMorph = tThing + 0.06, tDock = 2.74;
  const G = '#8a8780', SOFT = '#b3b0a8', TRACK = '#ECEAE4';

  // ── layout (scene coords) ──
  const LAP = { x: 64, y: 318, w: 610, h: 570, r: 18 };               // laptop screen card (morphs into the roster)
  const CLK = { x: 868, y: 452, r: 104 };
  const LEV = { x: 712, y: 652, w: 306, h: 470 };                      // effort lever card
  const CUP = { x: 150, base: 1372, h: 62 };                           // cup tower
  const TST = { x: 244, y: 1000, w: 416, h: 88 };                       // notification stack

  const hkA = (cs, a, fn) => { if (a <= 0.002) return; for (const c of cs) { c.save(); c.globalAlpha *= clamp(a); } fn(); for (const c of cs) c.restore(); };
  function hkGlow(T, x, y, r, a, sy = 1, col = '255,0,0') {
    if (a <= 0.01) return;
    T.save(); T.translate(x, y); T.scale(1, sy);
    const g = T.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, `rgba(${col},${0.55 * a})`); g.addColorStop(0.55, `rgba(${col},${0.2 * a})`); g.addColorStop(1, `rgba(${col},0)`);
    T.fillStyle = g; T.fillRect(-r, -r, 2 * r, 2 * r); T.restore();
  }
  function hkShadowCard(T, K, x, y, w, h, r, o = {}) {
    T.save(); T.shadowColor = `rgba(0,0,0,${o.sh ?? 0.4})`; T.shadowBlur = 40; T.shadowOffsetY = 22; fillRR(T, x, y, w, h, r, '#FFFFFF'); T.restore();
    fillRR(T, x, y, w, h, r, '#FFFFFF');
    fillRR(K, x, y, w, h, r, o.fill || '#FFFFFF'); strokeRR(K, x, y, w, h, r, o.stroke || 'rgba(17,17,17,0.14)', o.lw || 2);
  }
  // gravity fall after t0: returns {dx, dy, r}
  const hkFall = (t, t0, vx, vy, spin, g = 5200) => { const d = Math.max(0, t - t0); return { dx: vx * d, dy: vy * d + 0.5 * g * d * d, r: spin * d, on: d > 0 }; };
  // turbo after "harder"
  const turbo = t => E.inOutCubic(clamp((t - tHarder + 0.06) / 0.18)) * (1 - E.inCubic(clamp((t - tWorst) / 0.12)));
  const shakeAt = (t, k) => t > tWorst ? ring(t - tWorst, 7, 9) * k : 0;

  // ── 1 · to-do list (rows stream in faster than they get done) ──
  const TASKS = ['Reply to support tickets', 'Write the newsletter', 'Fix the checkout bug', 'Post on socials', 'Send invoices', 'Plan the launch',
    'Edit this week\'s reel', 'Follow up with leads', 'Update landing page', 'Answer investor email', 'Write a blog post', 'Design launch graphic',
    'Book sales calls', 'Clean up the inbox', 'Prep the demo', 'Onboard new customer', 'Pay contractors', 'Research keywords'];
  const TAGS = ['today', 'overdue', '9:00', 'today', 'overdue', 'asap', 'today', 'overdue'];
  // cumulative rows spawned by time t (accelerates on "working", turbo on "harder", stops at "worst")
  function rowsN(t) {
    const tt = Math.min(t, tWorst);
    let n = 6.2 + tt * 3.6 + 3.2 * Math.pow(Math.max(0, tt - tWork + 0.1), 1.6);
    n += 9 * Math.max(0, Math.min(tt, tWorst) - tHarder) * 1.4;
    return n;                                                 // frozen after "worst"
  }
  const RH = 64, LIST_TOP = 112;
  function hkLaptopScreen(T, K, t, w, h) {
    // title bar
    [0, 1, 2].forEach(i => circle(K, 32 + i * 24, 34, 7.5, i === 0 ? C.red : '#E3DFD6'));
    text(K, 'To-do · today', 116, 43, { font: F.grot, weight: 700, size: 27, color: C.ink, align: 'left', ls: -0.5 });
    const N = rowsN(t), open = 5 + Math.floor(N) - Math.floor(Math.max(0, (t - 0.5)) * 1.2);
    const cf = { font: F.mono, weight: 700, size: 22 }, cs = `${open} open`, cw = measure(K, cs, cf) + 30;
    const bump = 1 + ring(N % 1 < 0.25 ? (N % 1) * 0.3 : 1, 3, 9) * 0.0;
    fillRR(K, w - 26 - cw, 16, cw, 38, 19, C.red); text(K, cs, w - 26 - cw / 2, 43, Object.assign({ color: '#fff' }, cf));
    line(K, 0, 70, w, 70, TRACK, 2, 'butt');
    // rows (clipped)
    K.save(); K.beginPath(); K.rect(0, 72, w, h - 72); K.clip();
    const tb = turbo(t);
    const nTop = Math.floor(N);
    for (let j = nTop; j >= Math.max(0, nTop - 9); j--) {
      const y = LIST_TOP + (N - j - 1) * RH - 6 + 40;
      if (y > h + RH) continue;
      const age = N - j;                                        // 0..1 while sliding in
      const flash = clamp(1 - age * 1.4);
      const task = TASKS[j % TASKS.length], tag = TAGS[(j * 3) % TAGS.length], hot = tag === 'overdue' || tag === 'asap';
      if (flash > 0) fillRR(K, 10, y - RH / 2 + 4, w - 20, RH - 8, 12, `rgba(255,59,31,${0.13 * flash})`);
      // turbo streaks
      if (tb > 0.05 && age < 1.2) { K.save(); K.globalAlpha *= 0.18 * tb * (1.2 - age); fillRR(K, 10, y - RH / 2 - 30 * tb, w - 20, RH + 30 * tb, 12, C.red); K.restore(); }
      const done = j % 7 === 2 && age > 2.2;
      strokeRR(K, 26, y - 14, 28, 28, 7, done ? C.ink : '#C9C5BC', 3);
      if (done) check(K, 40, y, 26, clamp((age - 2.2) / 0.5), C.ink, 4);
      text(K, task, 70, y + 9, { font: F.grot, weight: 500, size: 25, color: done ? SOFT : C.ink, align: 'left', ls: -0.3 });
      if (done) line(K, 70, y + 1, 70 + measure(K, task, { font: F.grot, weight: 500, size: 25 }), y + 1, SOFT, 2.5, 'butt');
      const tf = { font: F.mono, weight: 700, size: 18 }, tw = measure(K, tag, tf) + 20;
      fillRR(K, w - 24 - tw, y - 15, tw, 30, 15, hot ? 'rgba(255,59,31,0.12)' : '#F1EEE6');
      text(K, tag, w - 24 - tw / 2, y + 6, Object.assign({ color: hot ? C.red : G }, tf));
      line(K, 24, y + RH / 2, w - 24, y + RH / 2, '#F3F0EA', 2, 'butt');
    }
    // bottom fade (rows spill off)
    const g = K.createLinearGradient(0, h - 70, 0, h); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,1)');
    K.fillStyle = g; K.fillRect(0, h - 70, w, 70);
    K.restore();
    return bump;
  }
  function lapXf(t) {
    const a = pop(t + 0.14, 2.3, 0.55);
    const push = turbo(t);
    const m = t < tMorph ? 0 : spring(t - tMorph, 2.5, 0.8);
    const sh = shakeAt(t, 14);
    return { a, m, push, sh };
  }
  function hkLaptop(T, K, t) {
    const { a, m, sh } = lapXf(t);
    if (t >= tDock) return;
    const ent = clamp(a);
    // screen rect: entrance (scale + drop) → morph into the roster rect
    let x = LAP.x, y = LAP.y - (1 - a) * 180, w = LAP.w, h = LAP.h;
    const s0 = lerp(1.18, 1, a);
    w *= s0; h *= s0; x -= (w - LAP.w) / 2; y -= (h - LAP.h) * 0.2;
    const rot = (1 - a) * -7 + sh * 0.22;
    const R1 = [RO.x, RO.y, RO_W * RO.s, RO_H * RO.s];
    const mm = clamp(m);
    const rx = lerp(x, R1[0], m), ry = lerp(y, R1[1], m) - Math.sin(mm * Math.PI) * 60, rw = lerp(w, R1[2], m), rh = lerp(h, R1[3], m);
    const cx = rx + rw / 2, cy = ry + rh / 2;
    // laptop base (keyboard) — drops away when the morph starts
    const bf = hkFall(t, tFall - 0.02, -160, 200, -60, 10000);
    if (!bf.on || bf.dy < 1400) hkA([T, K], ent * (bf.on ? 1 - clamp((t - tFall) / 0.25) : 1), () => X([T, K], cx + bf.dx, y + h + 2 + bf.dy, s0, rot * (1 - mm) + bf.r, () => {
      const bw = LAP.w + 80, bh = 40;
      T.save(); T.shadowColor = 'rgba(0,0,0,0.35)'; T.shadowBlur = 30; T.shadowOffsetY = 18; fillRR(T, -bw / 2, 0, bw, bh, 12, '#FFFFFF'); T.restore();
      K.beginPath(); K.moveTo(-LAP.w / 2 - 10, 0); K.lineTo(LAP.w / 2 + 10, 0); K.lineTo(bw / 2, bh - 10); K.quadraticCurveTo(bw / 2, bh, bw / 2 - 12, bh);
      K.lineTo(-bw / 2 + 12, bh); K.quadraticCurveTo(-bw / 2, bh, -bw / 2, bh - 10); K.closePath(); K.fillStyle = '#E9E5DC'; K.fill(); K.lineWidth = 3; K.strokeStyle = C.ink; K.stroke();
      fillRR(K, -60, 4, 120, 10, 5, '#CFCAC0');
    }));
    // the screen card
    X([T, K], cx, cy, 1, rot * (1 - mm), () => {
      const x0 = -rw / 2, y0 = -rh / 2;
      hkA([T, K], ent, () => {
        if (mm < 0.3) hkGlow(T, 0, 30, rw * 0.85, (0.35 + 0.45 * clamp((rowsN(t) - 6) / 14)) * (1 - mm / 0.3), 0.85);
        T.save(); T.shadowColor = 'rgba(0,0,0,0.42)'; T.shadowBlur = 44; T.shadowOffsetY = 26; fillRR(T, x0, y0, rw, rh, LAP.r, '#FFFFFF'); T.restore();
        fillRR(K, x0, y0, rw, rh, LAP.r, '#FFFFFF');
        strokeRR(K, x0, y0, rw, rh, LAP.r, lerp(1, 0, mm) > 0.5 ? C.ink : 'rgba(17,17,17,0.14)', lerp(4, 2, mm));
        const ca = (1 - clamp(m / 0.35)) * (t > tWorst ? lerp(1, 0.35, E.outCubic(clamp((t - tWorst) / 0.12))) : 1);
        if (ca > 0) hkA([K], ca, () => { K.save(); K.beginPath(); rr(K, x0, y0, rw, rh, LAP.r); K.clip(); K.translate(x0, y0); K.scale(rw / LAP.w, rh / LAP.h); hkLaptopScreen(T, K, t, LAP.w, LAP.h); K.restore(); });
      });
    });
    if (t < 0.4) burst(K, LAP.x + LAP.w / 2, LAP.y + LAP.h / 2, t + 0.12, { n: 14, r0: 330, r1: 470, color: C.ink, lw: 8, dur: 0.5 });
    // the roster fades in over the morphing card
    const ra = clamp((m - 0.22) / 0.38);
    if (ra > 0) { K.save(); K.globalAlpha *= ra; T.save(); T.globalAlpha *= ra; roster(T, K, rx, ry, rw / RO_W, { t }); T.restore(); K.restore(); }
  }

  // "team of 1" tag swinging from the laptop's top-right corner on "solo"
  function hkTag(T, K, t) {
    const t0 = tSolo - 0.06; if (t < t0) return;
    const { a, sh } = lapXf(t);
    const tk = LEV_IN + 0.1, kd = Math.max(0, t - tk);           // the incoming lever card knocks it off
    if (kd > 0.6) return;
    const out = 0;
    const px = LAP.x + LAP.w - 70 - 300 * kd, py = LAP.y + LAP.h - 6 - 260 * kd + 0.5 * 5200 * kd * kd;
    const sw = 22 * ring(t - t0, 1.6, 2.4) + sh * 0.8 - kd * 520;
    const sc = E.outBack(clamp((t - t0) / 0.22));
    hkA([K, T], 1 - out, () => X([T, K], px, py + out * 200, sc, sw + out * 50, () => {
      line(K, 0, 0, 0, 46, C.ink, 3);
      circle(K, 0, 0, 7, C.ink);
      const f = { font: F.mono, weight: 700, size: 24, ls: 1 }, w = measure(K, 'TEAM OF 1', f) + 46;
      T.save(); T.shadowColor = 'rgba(0,0,0,0.35)'; T.shadowBlur = 16; T.shadowOffsetY = 10; fillRR(T, -w / 2, 44, w, 56, 12, '#FFFFFF'); T.restore();
      fillRR(K, -w / 2, 44, w, 56, 12, C.red); circle(K, -w / 2 + 18, 72, 5, C.paper);
      text(K, 'TEAM OF 1', 8, 81, Object.assign({ color: '#fff' }, f));
    }));
  }

  // ── 2 · clock (hands whirl faster and faster) ──
  function clockAng(t) {                                         // minute-hand revolutions
    const tt = Math.min(t, tWorst);
    return 0.62 + tt * 0.55 + Math.pow(Math.max(0, tt - tWork), 2) * 1.6 + Math.max(0, tt - tHarder) * 3.2;
  }
  const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  function hkClock(T, K, t) {
    const a = pop(t + 0.16, 2.6, 0.5), f = hkFall(t, tFall - 0.02, 1100, -250, 300, 6500);
    if (f.dy > 1600) return;
    const rev = clockAng(t), tb = turbo(t), sh = shakeAt(t, 10);
    X([T, K], CLK.x + f.dx + sh, CLK.y + f.dy, clamp(a, 0, 1.3), (1 - clamp(a)) * 40 + f.r + sh, () => {
      const R = CLK.r;
      hkGlow(T, 0, 0, R * 2.1, 0.55 * tb);
      T.save(); T.shadowColor = 'rgba(0,0,0,0.4)'; T.shadowBlur = 30; T.shadowOffsetY = 18; circle(T, 0, 0, R, '#FFFFFF'); T.restore();
      circle(K, 0, 0, R, '#FFFFFF', C.ink, 7);
      for (let i = 0; i < 12; i++) { const an = i * TAU / 12, l = i % 3 ? 10 : 20; line(K, Math.cos(an) * (R - 16), Math.sin(an) * (R - 16), Math.cos(an) * (R - 16 - l), Math.sin(an) * (R - 16 - l), i % 3 ? SOFT : C.ink, i % 3 ? 3 : 5); }
      const mA = rev * TAU - Math.PI / 2, hA = rev / 12 * TAU * 6 - Math.PI / 2;
      // motion-blur fan behind the minute hand
      const spd = 0.55 + 2 * Math.max(0, Math.min(t, tWorst) - tWork) * 1.6 + (t > tHarder && t < tWorst ? 3.2 : 0);
      const fan = Math.min(1.9, spd * 0.12) * (t < tWorst ? 1 : 0);
      if (fan > 0.1) { K.save(); K.beginPath(); K.moveTo(0, 0); K.arc(0, 0, R - 22, mA - fan, mA); K.closePath(); K.fillStyle = 'rgba(255,59,31,0.22)'; K.fill(); K.restore(); }
      line(K, 0, 0, Math.cos(hA) * R * 0.48, Math.sin(hA) * R * 0.48, C.ink, 9);
      line(K, 0, 0, Math.cos(mA) * R * 0.74, Math.sin(mA) * R * 0.74, C.red, 6);
      circle(K, 0, 0, 9, C.ink);
      // bells
      [-1, 1].forEach(s => { K.save(); K.rotate(s * 0.62 + (t < tWorst ? Math.sin(t * 60) * 0.06 * (0.3 + tb) : 0)); K.beginPath(); K.arc(0, -R - 6, 26, Math.PI, 0); K.closePath(); K.fillStyle = C.ink; K.fill(); K.restore(); });
      // day pill flipping
      const d = Math.floor(rev / 2.2), df = (rev / 2.2) % 1, flip = clamp((df - 0.82) / 0.18);
      const pf = { font: F.mono, weight: 700, size: 22, ls: 2 };
      fillRR(K, -58, R + 18, 116, 40, 20, C.ink);
      K.save(); K.beginPath(); K.rect(-58, R + 18, 116, 40); K.clip();
      text(K, DAYS[d % DAYS.length], 0, R + 46 - flip * 40, Object.assign({ color: C.paper }, pf));
      text(K, DAYS[(d + 1) % DAYS.length], 0, R + 86 - flip * 40, Object.assign({ color: C.paper }, pf));
      K.restore();
    });
  }

  // ── 3 · coffee cup tower ──
  const CUP_T = [0.02, 0.3, 0.62, 0.98, 1.26, 1.5, 1.72];
  function hkCup(K, T, w, h) {
    T.save(); T.fillStyle = 'rgba(0,0,0,0.25)'; T.fillRect(-w / 2 + 6, -h + 8, w, h); T.restore();
    K.beginPath(); K.moveTo(-w / 2 + 6, -h + 12); K.lineTo(w / 2 - 6, -h + 12); K.lineTo(w / 2 - 14, 0); K.lineTo(-w / 2 + 14, 0); K.closePath();
    K.fillStyle = '#FFFFFF'; K.fill(); K.lineWidth = 4; K.strokeStyle = C.ink; K.lineJoin = 'round'; K.stroke();
    K.beginPath(); K.moveTo(-w / 2 + 8.5, -h * 0.62); K.lineTo(w / 2 - 8.5, -h * 0.62); K.lineTo(w / 2 - 11.6, -h * 0.26); K.lineTo(-w / 2 + 11.6, -h * 0.26); K.closePath();
    K.fillStyle = C.red; K.fill(); K.stroke();
    fillRR(K, -w / 2, -h, w, 14, 6, C.ink);
  }
  function hkCups(T, K, t) {
    const n = CUP_T.filter(c => t >= c - 0.2).length; if (!n) return;
    const tip = t > tWorst ? E.inCubic(clamp((t - tWorst - 0.05) / 0.4)) : 0;
    const wob = Math.sin(t * 7.5) * (0.8 + n * 0.55) * (t < tWorst ? 1 : 0.3) + shakeAt(t, 5);
    const fo = hkFall(t, tFall - 0.04, -500, -150, -160, 7000);
    if (fo.dy > 1300) return;
    X([T, K], CUP.x + fo.dx, CUP.base + fo.dy, 1, fo.r - tip * 38, () => {
      fillRR(K, -78, -4, 156, 14, 7, C.ink);
      let ang = 0, x = 0, y = -4;
      CUP_T.forEach((c, i) => {
        if (t < c - 0.2) return;
        const d = t - c;
        const dropY = d < 0 ? -Math.pow(-d / 0.2, 2) * 700 : 0;
        const sq = d > 0 ? ring(d, 4, 10) * 0.12 : 0;
        ang += (wob * (i + 1) * 0.3 - tip * 6 * i) * D2R;
        K.save(); T.save();
        for (const c2 of [K, T]) { c2.translate(x, y + dropY); c2.rotate(ang); c2.scale(1 + sq, 1 - sq); }
        hkCup(K, T, 108, CUP.h);
        K.restore(); T.restore();
        x += Math.sin(ang) * CUP.h; y -= Math.cos(ang) * CUP.h;
      });
    });
  }

  // ── 4 · notifications ──
  const NOTES = [
    { t: 0.28, app: 'Support', msg: 'New ticket: refund request' },
    { t: 0.72, app: 'Inbox', msg: 'Invoice overdue · reply?' },
    { t: 1.12, app: 'Newsletter', msg: 'Issue due tonight' },
    { t: 1.5, app: 'Sales', msg: 'Missed follow-up' },
    { t: 1.74, app: 'Design', msg: 'Launch graphic needed' },
    { t: 1.92, app: 'Blog', msg: 'Draft not started' },
  ];
  function hkToasts(T, K, t) {
    const vis = NOTES.filter(n => t >= n.t);
    const nv = vis.length;
    vis.forEach((n, i) => {
      const k = nv - 1 - i;                                   // 0 = newest (top)
      if (k > 3) return;
      const a = pop(t - n.t, 2.8, 0.55);
      // stack position springs as newer ones push in
      let slot = 0; for (let j = i + 1; j < nv; j++) slot += pop(t - NOTES[j].t, 2.4, 0.6);
      const y = TST.y + slot * (TST.h + 10) * 0.86, s = 1 - slot * 0.04;
      const fade = clamp(1 - (slot - 2.2) / 0.8);
      const out = hkFall(t, tFall - 0.04 + 0.03 * k, -2600, -100, -30, 3000);
      const sh = shakeAt(t, 8);
      if (fade <= 0) return;
      hkA([T, K], fade * clamp(a * 3), () => X([T, K], TST.x + TST.w / 2 + (1 - clamp(a)) * 520 + out.dx + sh, y + TST.h / 2 + out.dy, s * lerp(0.9, 1, clamp(a)), (1 - clamp(a)) * 8 + out.r * 0.1, () => {
        const x0 = -TST.w / 2, y0 = -TST.h / 2;
        hkShadowCard(T, K, x0, y0, TST.w, TST.h, 20, { sh: 0.3 });
        fillRR(K, x0 + 16, y0 + 16, 50, 50, 13, k === 0 ? C.red : C.ink);
        // tiny bell glyph
        K.save(); K.translate(x0 + 41, y0 + 41); K.fillStyle = '#fff'; K.beginPath(); K.moveTo(-11, 7); K.quadraticCurveTo(-10, -12, 0, -12); K.quadraticCurveTo(10, -12, 11, 7); K.closePath(); K.fill(); circle(K, 0, 10, 3.5, '#fff'); K.restore();
        text(K, n.app, x0 + 82, y0 + 35, { font: F.grot, weight: 700, size: 23, color: C.ink, align: 'left' });
        text(K, 'now', x0 + TST.w - 20, y0 + 35, { font: F.mono, weight: 500, size: 18, color: G, align: 'right' });
        text(K, n.msg, x0 + 82, y0 + 64, { font: F.grot, weight: 500, size: 22, color: '#55524C', align: 'left' });
      }));
    });
  }

  // ── 5 · EFFORT lever ──
  const LEV_IN = tWork - 0.12;
  function levAng(t) {                                          // -60 (low) … +60 (max), degrees from vertical
    if (t < tHarder - 0.05) return lerp(-52, -14, E.outCubic(clamp((t - LEV_IN - 0.1) / (tHarder - LEV_IN)))) + Math.sin(t * 40) * 1.5 * clamp(t - tWork);
    const d = t - (tHarder - 0.05);
    return 62 - 76 * Math.exp(-d * 9) * Math.cos(d * 26) * (d < 0.08 ? 1 : 1) + Math.sin(t * 70) * 2.2 * clamp(d * 3);
  }
  function hkLever(T, K, t) {
    if (t < LEV_IN) return;
    const a = pop(t - LEV_IN, 2.4, 0.6), sh = shakeAt(t, 12);
    const fall = hkFall(t, tThing - 0.04, 1900, -150, 70, 9000);
    if (fall.dy > 1600) return;
    const cx = LEV.x + LEV.w / 2, cy = LEV.y + LEV.h / 2;
    const tb = turbo(t), maxed = t > tHarder - 0.02;
    X([T, K], cx + (1 - clamp(a)) * 420 + fall.dx + sh, cy + fall.dy, 1, (1 - clamp(a)) * 14 + fall.r, () => {
      const x0 = -LEV.w / 2, y0 = -LEV.h / 2, w = LEV.w, h = LEV.h;
      hkGlow(T, 0, 120, 340, (maxed ? 1 : 0) * (0.75 + 0.25 * Math.sin(t * 30)) * (t < tWorst + 0.4 ? 1 : 0.4), 0.9);
      hkShadowCard(T, K, x0, y0, w, h, 24, { stroke: C.ink, lw: 4 });
      text(K, '// EFFORT', x0 + 26, y0 + 46, { font: F.mono, weight: 700, size: 22, color: G, align: 'left' });
      const broke = t >= tWorst;
      const lvl = broke ? 'BROKEN' : maxed ? 'MAX' : 'HIGH';
      const lp = maxed && !broke ? 1 + ring(t - tHarder, 4, 9) * 0.18 : broke ? 1 + ring(t - tWorst, 4, 9) * 0.18 : 1;
      X([K], x0 + 26, y0 + 120, lp, 0, () => text(K, lvl, 0, 0, { font: F.grot, weight: 700, size: broke ? 52 : 68, color: maxed ? C.red : C.ink, align: 'left', ls: -2 }));
      // gauge arc
      const px = 0, py = y0 + h - 70, R = 118;
      for (let i = 0; i <= 12; i++) {
        const an = (-150 + i * 10) * D2R, hot = i >= 9;
        const on = maxed || i <= Math.round((levAng(t) + 60) / 10);
        line(K, px + Math.cos(an) * (R + 14), py + Math.sin(an) * (R + 14), px + Math.cos(an) * (R + 36), py + Math.sin(an) * (R + 36), hot ? (on ? C.red : 'rgba(255,59,31,0.3)') : (on ? C.ink : '#DDD9D0'), hot ? 9 : 7);
      }
      text(K, 'low', px - R - 4, py + 34, { font: F.mono, weight: 500, size: 20, color: G });
      text(K, 'max', px + R + 4, py + 34, { font: F.mono, weight: 700, size: 20, color: C.red });
      // lever stick (snaps on "worst": the top half flies off)
      const ang = (broke ? levAng(tWorst - 0.001) : levAng(t)) * D2R;
      const L = 150, br = 0.5;
      const dir = [Math.sin(ang), -Math.cos(ang)];
      const bx = px + dir[0] * L * br, by = py + dir[1] * L * br;
      line(K, px, py, broke ? bx : px + dir[0] * L, broke ? by : py + dir[1] * L, C.ink, 14);
      if (broke) {
        // jagged break
        K.save(); K.translate(bx, by); K.rotate(ang); K.beginPath(); K.moveTo(-7, 0); K.lineTo(-3, -9); K.lineTo(1, -2); K.lineTo(5, -10); K.lineTo(7, 0); K.closePath(); K.fillStyle = C.ink; K.fill(); K.restore();
        burst(K, bx, by, t - tWorst, { n: 10, r0: 16, r1: 110, color: C.red, lw: 7, dur: 0.36 });
      }
      fillRR(K, px - 54, py - 8, 108, 36, 12, C.ink); circle(K, px, py, 16, '#FFFFFF', C.ink, 5);
      if (!broke) {
        const kx = px + dir[0] * L, ky = py + dir[1] * L;
        T.save(); T.shadowColor = 'rgba(0,0,0,0.35)'; T.shadowBlur = 14; T.shadowOffsetY = 8; circle(T, kx, ky, 30, '#FFFFFF'); T.restore();
        circle(K, kx, ky, 30, C.red, C.ink, 5); circle(K, kx - 9, ky - 10, 7, 'rgba(255,255,255,0.7)');
        if (maxed) burst(K, kx, ky, t - tHarder + 0.02, { n: 12, r0: 40, r1: 150, color: C.ink, lw: 7, dur: 0.34 });
        if (maxed && t < tWorst) { // sparks
          const r = rng(Math.floor(t * 24));
          for (let i = 0; i < 4; i++) { const an = r() * TAU, d = 36 + r() * 40; line(K, kx + Math.cos(an) * d, ky + Math.sin(an) * d, kx + Math.cos(an) * (d + 14), ky + Math.sin(an) * (d + 14), C.red, 4); }
        }
      }
    });
    // the snapped-off handle tumbles away (outside the card transform; drawn in front)
    if (t >= tWorst) {
      const d = t - tWorst, ang = levAng(tWorst - 0.001) * D2R, L = 150;
      const px = cx, py = cy + LEV.h / 2 - 70;
      const sx = px + Math.sin(ang) * L * 0.75, sy = py - Math.cos(ang) * L * 0.75;
      const fx = sx + 520 * d, fy = sy - 900 * d + 0.5 * 5200 * d * d, rot = ang + d * 14;
      if (fy < 2300) X([T, K], fx, fy, 1, rot / D2R, () => {
        line(K, 0, L * 0.25, 0, -L * 0.25, C.ink, 14);
        circle(K, 0, -L * 0.25, 30, C.red, C.ink, 5);
      });
    }
  }

  // ── 6 · stamp ──
  function hkStamp(T, K, t) {
    const t0 = tWorst - 0.04; if (t < t0) return;
    const out = clamp((t - tFall - 0.12) / 0.2);
    if (out >= 1) return;
    const dt = t - t0;
    hkGlow(T, 400, 640, 520, clamp(dt / 0.1) * (1 - out) * 0.8, 0.55);
    hkA([K], 1 - out, () => X([K], 400 - out * 0, 640 + out * 140, 1 + out * 0.2, 0, () => stamp(K, T, 'NOT THE FIX', 0, 0, dt, { size: 104, rot: -9, col: C.red, sub: 'MORE HOURS ≠ MORE DONE' })));
  }

  SC.hook = {
    label: '// 01 — hook', bg: 'light', style: 'classic',
    cam: t => {
      if (t >= tDock) return { x: 0, y: 0, z: 1, r: 0 };
      const intro = 1 - E.outCubic(clamp((t + 0.08) / 0.55));
      const push = 0.035 * E.inOutCubic(clamp((t - 0.3) / 1.1)) + 0.03 * turbo(t) + 0.02 * ring(t - tHarder, 2, 6) * (t > tHarder ? 1 : 0);
      const rel = 1 - E.inOutCubic(clamp((t - tThing) / (tDock - tThing - 0.06)));
      const z = 1 + (0.07 * intro + push) * rel;
      const jit = turbo(t) * 3;
      return { z, r: (-0.012 * intro + 0.004 * turbo(t) * Math.sin(t * 50)) * rel, x: noise1(t * 30) * jit * rel, y: (960 - 330) * (z - 1) };
    },
    draw(T, K, t) {
      if (t >= tDock) { roster(T, K, RO.x, RO.y, RO.s, { t }); return; }
      hkCups(T, K, t);
      hkToasts(T, K, t);
      hkClock(T, K, t);
      hkLever(T, K, t);
      hkLaptop(T, K, t);
      hkTag(T, K, t);
      hkStamp(T, K, t);
    },
    guy(t) {
      if (t >= tDock) return { x: PRESENTER_DOCK.x, y: PRESENTER_DOCK.y, s: PRESENTER_DOCK.s };
      const m = E.inOutCubic(clamp((t - tThing) / (tDock - tThing - 0.04)));
      const jerk = t > tWorst ? ring(t - tWorst, 2.6, 6) * 18 : 0;
      const grind = win(t, tWork - 0.05, tWorst - 0.05, 0.12, 0.15);
      const x = lerp(800, PRESENTER_DOCK.x, m), y = lerp(1990 + jerk + Math.abs(Math.sin(t * 16)) * 10 * grind * (t > tHarder ? 1 : 0.4), PRESENTER_DOCK.y, m), s = lerp(0.9, PRESENTER_DOCK.s, m);
      const shake = t > tWorst && t < tThing + 0.3 ? Math.sin((t - tWorst) * 28) * clamp(1 - (t - tWorst) / 0.7) : 0;
      return Object.assign({ x, y, s, lean: -3 * grind + 2 * win(t, -1, tWork - 0.1, 0.1, 0.2) },
        arms(t, [[-1, tFounder + 0.3, 'L', 'point', { pointAng: -38 }],
          [tWork - 0.04, tHarder - 0.02, 'R', 'fist'],
          [tHarder - 0.06, tWorst - 0.08, 'LR', 'fist'],
          [tWorst - 0.02, tThing + 0.1, 'L', 'point', { pointAng: -28 }]]),
        expr(t, [[-1, tFounder + 0.25, { brow: 0.7, browTilt: 0.4, smile: 0.4 }],
          [tWork - 0.05, tHarder, { brow: -0.3, smile: -0.1, sweat: 0.5 }],
          [tHarder, tWorst - 0.06, { brow: -0.6, smile: -0.4, sweat: 1 }],
          [tWorst - 0.04, tThing + 0.1, { brow: 0.9, shock: 0.2, smile: -0.3 }]]),
        { lookX: -0.55 * win(t, -1, tFounder + 0.3, 0.1, 0.2) - 0.6 * win(t, tWorst, tThing + 0.25, 0.08, 0.2),
          lookY: -0.3 * win(t, -1, tFounder + 0.3, 0.1, 0.2) - 0.4 * win(t, tWorst, tThing + 0.25, 0.08, 0.2),
          headTurn: -0.25 * win(t, -1, tFounder + 0.3, 0.1, 0.2) + 0.3 * shake,
          headTilt: -5 * win(t, tHarder, tWorst, 0.1, 0.15) });
    },
  };
  kick(tWorst - 0.03, 0.8, 0.9);   // the one punch: lever snaps + NOT THE FIX stamp
})();
