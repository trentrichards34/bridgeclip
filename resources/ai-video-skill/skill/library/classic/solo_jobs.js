// ═════════════ 02 · JOBS  [wi(14)−0.1 ≈ 2.96 → wi(31)−0.1 ≈ 7.14] · classic orange look ═════════════
// NOTE: reference code from a real reel. Word indices (wi(n)) refer to that reel's script; re-cue on your own words.json.
// Through-object left in: roster() with rosterBump(); the badges are sucked into its pills, so it is part of the choreography.
// assets not included: none (all vector drawing).
// "You're the founder, the salesperson, the marketer, the support desk and the one who writes the newsletter."
// Beats: a clothesline whips across the stage under the captions and five clothes-pins clip on ("You're") → on each job word an
// employee ID badge drops off its pin on a red lanyard (bungee stretch, pendulum swing, squash) with a clone of the presenter as the photo,
// and the job's prop slams onto the clone: FOUNDER crown · SALES tie + ringing call timer · MARKETING megaphone blasting likes ·
// SUPPORT headset + a pile of tickets. Every landing loads the line (it sags more), jolts the other badges and bumps the roster's
// job pill. "and the one who…" → the heavy NEWSLETTER badge drops on the long string, the line sags hard (kick), the other badges
// spin between tasks (flip to the back: "you."), then the lanyards snap one by one and each badge is sucked into its pill on the
// roster card; the newsletter badge types its own title and lands last on "newsletter". The line pulls out. Docked by 6.88.
// Hand-off: 2.96 and ≥ 6.88 are exactly roster(RO) + the presenter at PRESENTER_DOCK, camera identity. Helpers prefixed jb.
(() => {
  const S0 = wi(14) - 0.1, S1 = wi(31) - 0.1;                 // 2.96 → 7.14
  const T_YOU = wi(14);                                        // "You're" 3.06
  const T_LINE = S0 + 0.04;                                    // clothesline whips in
  const NAMES = ['FOUNDER', 'SALES', 'MARKETING', 'SUPPORT', 'NEWSLETTER'];
  const HX = [210, 540, 870, 375, 705];                        // pin x on the line
  const LEN = [92, 92, 92, 520, 520];                          // lanyard length (pin → badge clip)
  const BW = 290, BH = 410;
  const HIT = [HATS[0], HATS[1], HATS[2], HATS[3], wi(24) + 0.02];   // founder 3.38 · sales 3.87 · marketer 4.66 · support 5.31 · "and" 5.98
  const FALL = [0.14, 0.14, 0.14, 0.2, 0.22];
  const SW0 = [-15, 13, -12, 11, -9];                          // swing amplitude on landing (deg)
  const DEP = [6.08, 6.16, 6.24, 6.32, 6.50];                  // lanyard snaps
  const FLY = [0.28, 0.28, 0.28, 0.28, 0.25];
  const ARR = DEP.map((d, i) => d + FLY[i]);                   // lands in its roster pill (newsletter 6.75 ≈ "newsletter" 6.74)
  const T_FLIP = [5.56, 5.66, 5.76, 5.86];                     // chaos: badges spin between tasks
  const T_TYPE0 = 6.18, T_TYPE1 = 6.46;                        // the newsletter badge types its own title
  const T_OUT = 6.56, T_GONE = 6.84;                           // line pulls out to the right
  const SETTLE = 6.88;
  const WGT = [12, 12, 12, 14, 30];                            // how much each badge loads the line
  const LX0 = -100, LX1 = 1180, LY0 = 236;
  const ly0 = t => LY0 + 58 * E.inOutCubic(P(t, 6.12, 0.26));   // line drops as the caption wraps to two lines                     // line pinned outside the frame
  kick(HIT[4] + 0.01, 0.55, 0.45);                             // the one punch: the newsletter badge loads the line

  // ── line ──
  const sagAt = t => WGT.reduce((a, w, i) => a + w * (pop(t - HIT[i], 2.2, 0.3) - pop(t - DEP[i], 2.6, 0.32)), 0);
  const lineY = (x, t) => { const u = (x - LX0) / (LX1 - LX0); return ly0(t) + sagAt(t) * 4 * u * (1 - u); };
  const lineSpan = t => [lerp(LX0, LX1, E.inCubic(P(t, T_OUT, T_GONE - T_OUT))), lerp(LX0, LX1, E.outCubic(P(t, T_LINE, 0.34)))];

  // ── roster pill centres (same maths as the kit roster) ──
  const pillC = i => {
    const f = { font: F.grot, weight: 600, size: 19 }, pw = measure(K0(), HAT_NAMES[i], f) + 22;
    return [RO.x + (130 + (i % 3) * 124 + pw / 2) * RO.s, RO.y + (100 + Math.floor(i / 3) * 44) * RO.s];
  };
  let _k0 = null; const K0 = () => _k0 || (_k0 = document.createElement('canvas').getContext('2d'));

  // ── pendulum: pivot on the line, angle, string length, scale ──
  function pend(i, t) {
    const hx = HX[i], hy = lineY(hx, t);
    const t0 = HIT[i] - FALL[i];
    if (t < t0) return null;
    const fp = clamp((t - t0) / FALL[i]), dt = t - HIT[i];
    let L, th, sc, a;
    if (dt < 0) { L = LEN[i] * fp * fp; th = SW0[i] * 0.6 * fp; sc = lerp(0.28, 1, E.outCubic(fp)); a = clamp(fp * 4); }
    else {
      L = LEN[i] + (LEN[i] * 0.05 + 16) * Math.exp(-6 * dt) * Math.sin(TAU * 2.6 * dt);
      th = SW0[i] * Math.exp(-2.0 * dt) * Math.cos(TAU * 1.2 * dt);
      sc = 1; a = 1;
    }
    // the shared line carries every other landing into this badge
    for (let j = 0; j < 5; j++) if (j !== i && t > HIT[j] && t > t0) {
      const d = t - HIT[j], amp = j === 4 ? 13 : 3.5;
      th += amp * ((i + j) % 2 ? 1 : -1) * Math.exp(-(j === 4 ? 2.6 : 4) * d) * Math.sin(TAU * (j === 4 ? 1.5 : 2) * d);
    }
    th += Math.sin(t * 2.1 + i * 1.7) * 1.2 * clamp((t - HIT[i]) / 0.6);   // idle sway
    const sq = dt >= 0 ? 0.07 * ring(dt, 4, 10) : 0;
    return { hx, hy, L, th, sc, a, sq };
  }
  // badge centre in scene coords for a pendulum state
  const badgeCentre = q => { const r = q.th * D2R, d = q.L + 6 + BH / 2; return [q.hx - Math.sin(r) * d, q.hy + Math.cos(r) * d]; };

  // ── small drawing helpers ──
  const jbA = (cs, a, fn) => { if (a <= 0.002) return; for (const c of cs) { c.save(); c.globalAlpha *= clamp(a); } fn(); for (const c of cs) c.restore(); };
  function jbGlow(T, x, y, r, a) {
    if (a <= 0.003) return;
    const g = T.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,0,0,${Math.min(1, a)})`); g.addColorStop(0.55, `rgba(255,0,0,${Math.min(1, a) * 0.35})`); g.addColorStop(1, 'rgba(255,0,0,0)');
    T.fillStyle = g; T.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // draw fn in a clone's head space (bust units) / torso space
  function inSpace(K, M, fn) { const m0 = K.getTransform(); K.save(); K.setTransform(m0.multiply(M)); fn(); K.restore(); }
  function jbPin(K, x, y, s) {             // a clothes pin clipped on the line
    if (s <= 0.01) return;
    X([K], x, y, s, 0, () => {
      fillRR(K, -9, -24, 18, 44, 6, '#F3EEE3'); strokeRR(K, -9, -24, 18, 44, 6, C.ink, 3);
      line(K, 0, -20, 0, 16, C.ink, 2);
      circle(K, 0, -2, 4.5, C.red, C.ink, 2);
    });
  }
  function jbRibbon(K, L) {                // red lanyard from the pin (0,0) down to the clip (0,L)
    if (L <= 2) return;
    fillRR(K, -7, 0, 14, L, 3, C.red);
    line(K, -7, 2, -7, L - 2, C.ink, 2, 'butt'); line(K, 7, 2, 7, L - 2, C.ink, 2, 'butt');
    fillRR(K, -11, L - 4, 22, 16, 4, '#BDB7AC'); strokeRR(K, -11, L - 4, 22, 16, 4, C.ink, 2.5);    // metal clip
  }

  // ── props ──
  function crown(K, p) {                   // head space, sits on the beanie
    if (p <= 0) return;
    const dy = -(1 - E.outCubic(clamp(p * 1.6))) * 260, sq = ring(p * 0.5 - 0.06, 3, 9) * 0.12;
    K.save(); K.translate(0, -262 + dy); K.rotate(-8 * D2R); K.scale(1 + sq, 1 - sq);
    K.beginPath(); K.moveTo(-112, 0); K.lineTo(-128, -118); K.lineTo(-62, -58); K.lineTo(0, -150); K.lineTo(62, -58); K.lineTo(128, -118); K.lineTo(112, 0); K.closePath();
    K.fillStyle = C.red; K.fill(); K.lineJoin = 'round'; K.lineWidth = 11; K.strokeStyle = C.ink; K.stroke();
    fillRR(K, -116, -22, 232, 30, 8, '#F3EEE3'); strokeRR(K, -116, -22, 232, 30, 8, C.ink, 9);
    for (const [x, y] of [[-128, -118], [0, -150], [128, -118]]) circle(K, x, y, 15, '#F3EEE3', C.ink, 8);
    K.restore();
  }
  function tie(K, p) {                     // torso space
    if (p <= 0) return;
    K.save(); K.translate(0, -352); K.rotate((1 - E.outBack(clamp(p))) * -95 * D2R);
    K.beginPath(); K.moveTo(-26, 0); K.lineTo(26, 0); K.lineTo(16, 40); K.lineTo(-16, 40); K.closePath();
    K.fillStyle = C.redD; K.fill(); K.lineWidth = 9; K.strokeStyle = C.ink; K.lineJoin = 'round'; K.stroke();
    K.beginPath(); K.moveTo(-16, 40); K.lineTo(16, 40); K.lineTo(44, 230); K.lineTo(0, 280); K.lineTo(-44, 230); K.closePath();
    K.fillStyle = C.red; K.fill(); K.stroke();
    line(K, -30, 130, 34, 100, '#FFFFFF', 9); line(K, -38, 190, 40, 160, '#FFFFFF', 9);
    K.restore();
  }
  function headset(K, p) {                 // head space
    if (p <= 0) return;
    const s = E.outBack(clamp(p));
    K.save(); K.translate(0, -40); K.scale(s, s); K.translate(0, 40);
    K.lineCap = 'round'; K.strokeStyle = C.ink; K.lineWidth = 30;
    K.beginPath(); K.arc(0, -40, 214, Math.PI * 1.04, Math.PI * 1.96); K.stroke();
    K.strokeStyle = '#5E5850'; K.lineWidth = 12; K.beginPath(); K.arc(0, -40, 214, Math.PI * 1.1, Math.PI * 1.9); K.stroke();
    for (const sx of [-1, 1]) { fillRR(K, sx * 214 - 34, -50, 68, 110, 26, C.ink); fillRR(K, sx * 214 - 18, -34, 36, 78, 14, C.red); }
    K.lineWidth = 14; K.strokeStyle = C.ink; K.beginPath(); K.moveTo(-214, 40); K.quadraticCurveTo(-200, 170, -70, 150); K.stroke();
    circle(K, -62, 150, 24, C.red, C.ink, 9);
    K.restore();
  }
  function megaphone(K, p) {               // head space, held at the mouth, blasting up-left
    if (p <= 0) return;
    const s = E.outBack(clamp(p)), kick = ring(p - 0.6, 6, 12) * 0.1;
    K.save(); K.translate(-70, 128); K.rotate(24 * D2R); K.scale(s * (1 + kick), s * (1 + kick));
    K.beginPath(); K.moveTo(0, -30); K.lineTo(-250, -120); K.lineTo(-250, 120); K.lineTo(0, 30); K.closePath();
    K.fillStyle = C.red; K.fill(); K.lineWidth = 11; K.lineJoin = 'round'; K.strokeStyle = C.ink; K.stroke();
    K.beginPath(); K.ellipse(-250, 0, 34, 120, 0, 0, TAU); K.fillStyle = '#F3EEE3'; K.fill(); K.stroke();
    fillRR(K, -6, -36, 40, 72, 12, C.ink);
    line(K, -110, -66, -110, 66, '#FFFFFF', 10);
    K.restore();
  }
  function laptop(K, p, t) {               // badge photo space: the lid back facing us
    if (p <= 0) return;
    const y = lerp(80, 0, E.outBack(clamp(p)));
    K.save(); K.translate(0, y);
    fillRR(K, -96, 222, 192, 98, 12, '#2A2724'); strokeRR(K, -96, 222, 192, 98, 12, C.ink, 3);
    envelope(K, 0, 268, 50, 34, 3, C.ink, C.red);
    fillRR(K, -116, 316, 232, 14, 6, '#8C857A'); strokeRR(K, -116, 316, 232, 14, 6, C.ink, 3);
    K.restore();
  }

  // ── a clone of the presenter inside the badge photo ──
  const PH = { x: -BW / 2 + 14, y: 106, w: BW - 28, h: 206 };
  const CS = 0.33, CY = [40, 4, 10, 4, 0];
  function cloneState(i, t) {
    const d = t - HIT[i], ch = win(t, 5.5, 6.6, 0.3, 0.1);
    const base = { x: 0, y: PH.y + 10 + 865 * CS + CY[i] + (1 - pop(d - 0.02, 2.4, 0.5)) * 150, s: CS, t, mouth: 0.05, still: false };
    let o;
    if (i === 0) o = { smile: 0.85, brow: 0.45, headTilt: -5, armR: 'fist', armRp: win(t, HIT[i] + 0.16, 99, 0.2), lookX: 0.2 };
    else if (i === 1) o = { smile: 0.9, brow: 0.5, armL: 'wave', armLp: win(t, HIT[i] + 0.2, 99, 0.2), wave: t * 10, mouth: 0.18 + 0.32 * Math.abs(Math.sin(t * 13)), headTilt: 4, lookX: -0.2 };
    else if (i === 2) o = { smile: 0.35, brow: 0.8, armL: 'fist', armLp: win(t, HIT[i] + 0.06, 99, 0.18), mouth: 0.55 + 0.25 * Math.sin(t * 17), headTilt: -6, lookX: -0.5, lookY: -0.3 };
    else if (i === 3) o = { smile: -0.4, brow: 0.6, browTilt: 0.8, sweat: clamp((d - 0.3) / 0.4), armR: 'facepalm', armRp: win(t, HIT[i] + 0.55, 99, 0.25), headTilt: 6 };
    else o = { smile: 0.2, brow: -0.1, lookY: 0.75, lookX: -0.1, headNod: 0.3 + 0.15 * Math.sin(t * 14), headTilt: -3 };
    o.sweat = Math.max(o.sweat || 0, ch * 0.9);
    if (i < 4) o.headTurn = 0.35 * Math.sin(TAU * 3.2 * (t - 5.5)) * ch;
    return Object.assign(base, o);
  }
  function drawClone(T, K, i, t) {
    const b = cloneState(i, t);
    const st = guyState(t + i * 0.83 + 0.4, b);          // offset clock: clones blink on their own schedule
    st.t = t;
    const R = window.GUY3D && GUY3D.rig ? GUY3D.rig(st) : null;
    if (window.GUY3D) GUY3D.draw(T, K, st); else drawGuy && drawGuy(T, K, st);
    if (!R) return;
    const Mh = R.root.multiply(R.head), Mt = R.root.multiply(R.torso), pp = t - HIT[i] - 0.1;
    if (i === 0) inSpace(K, Mh, () => crown(K, clamp(pp / 0.3)));
    if (i === 1) inSpace(K, Mt, () => tie(K, clamp(pp / 0.22)));
    if (i === 2) inSpace(K, Mh, () => megaphone(K, clamp(pp / 0.2)));
    if (i === 3) inSpace(K, Mh, () => headset(K, clamp(pp / 0.2)));
    if (i === 4) laptop(K, clamp((t - HIT[4] - 0.08) / 0.25), t);
  }

  // ── status line under the photo ──
  function status(i, t) {
    const d = t - HIT[i];
    if (i === 0) return 'pitching';
    if (i === 1) { const s = Math.max(0, Math.floor((d - 0.15) * 9)); return 'on a call 0:' + String(s).padStart(2, '0'); }
    if (i === 2) return 'posting 24/7';
    if (i === 3) { const n = d < 0.15 ? 1 : d < 0.3 ? 3 : d < 0.45 ? 5 : d < 0.6 ? 8 : 12; return `${n} tickets`; }
    return 'drafting' + '...'.slice(0, 1 + Math.floor(t * 6) % 3);
  }

  // ── one badge (local: clip point at (0,0), badge hangs below) ──
  function badge(T, K, i, t, o = {}) {
    const x = -BW / 2, hot = i === 4 ? t >= HIT[4] : t >= HIT[i] && (i === 3 || t < HIT[i + 1]);
    const flip = o.flip ?? 1;                              // cos of the spin angle
    K.save(); T.save(); K.translate(0, BH / 2); T.translate(0, BH / 2); K.scale(Math.max(0.02, Math.abs(flip)), 1); T.scale(Math.max(0.02, Math.abs(flip)), 1); K.translate(0, -BH / 2); T.translate(0, -BH / 2);
    T.save(); T.shadowColor = 'rgba(0,0,0,0.42)'; T.shadowBlur = 34; T.shadowOffsetY = 20; fillRR(T, x, 0, BW, BH, 22, '#FFFFFF'); T.restore();
    fillRR(T, x, 0, BW, BH, 22, '#FFFFFF');
    if (flip < 0) {                                        // back side: it's still you
      fillRR(K, x, 0, BW, BH, 22, C.ink);
      fillRR(K, -34, 16, 68, 14, 7, '#3A3633');
      text(K, 'you.', 0, BH / 2 + 40, { font: F.serif, italic: true, weight: 400, size: 120, color: '#F3EEE3' });
      text(K, 'ALSO YOU', 0, BH - 40, { font: F.mono, weight: 700, size: 22, color: C.red, ls: 3 });
    } else {
      fillRR(K, x, 0, BW, BH, 22, '#FFFFFF'); strokeRR(K, x, 0, BW, BH, 22, C.ink, 4);
      fillRR(K, -34, 16, 68, 14, 7, '#E6E1D6'); strokeRR(K, -34, 16, 68, 14, 7, C.ink, 2.5);
      // header band (red = the job that just landed)
      fillRR(K, x + 14, 42, BW - 28, 54, 12, hot ? C.red : C.ink);
      let label = NAMES[i];
      if (i === 4) label = NAMES[4].slice(0, Math.round(10 * clamp((t - T_TYPE0) / (T_TYPE1 - T_TYPE0))));
      const lf = { font: F.mono, weight: 700, size: 30, ls: 3 };
      text(K, label, 0, 80, Object.assign({ color: '#FFFFFF' }, lf));
      if (i === 4 && t < T_TYPE1 + 0.2) { const lw = measure(K, label, lf); caretAt(K, lw / 2 + 2, 80, 30, t, '#FFFFFF'); }
      // photo with the clone
      fillRR(K, PH.x, PH.y, PH.w, PH.h, 14, i === 4 ? '#E9E2D4' : '#EFE8DA');
      for (const c of [T, K]) { c.save(); rr(c, PH.x, PH.y, PH.w, PH.h, 14); c.clip(); }
      for (let k = 0; k < 7; k++) line(K, PH.x + 18 + k * 40, PH.y, PH.x - 40 + k * 40, PH.y + PH.h, 'rgba(17,17,17,0.035)', 14);
      drawClone(T, K, i, t);
      for (const c of [T, K]) c.restore();
      strokeRR(K, PH.x, PH.y, PH.w, PH.h, 14, C.ink, 3);
      // footer
      text(K, 'you', x + 22, 358, { font: F.serif, italic: true, weight: 400, size: 46, color: C.ink, align: 'left' });
      text(K, 'ID 0001', BW / 2 - 22, 352, { font: F.mono, weight: 500, size: 20, color: '#8a8780', align: 'right' });
      const pulse = 0.5 + 0.5 * Math.sin(t * 9 + i);
      circle(K, x + 30, 386, 7, i === 3 || i === 1 ? `rgba(255,59,31,${0.55 + 0.45 * pulse})` : C.red);
      text(K, status(i, t), x + 46, 394, { font: F.mono, weight: 500, size: 22, color: C.ink, align: 'left' });
    }
    K.restore(); T.restore();
  }

  // ── extras that break out of a badge frame (badge-local coords, front side only) ──
  function extras(T, K, i, t, flip) {
    if (flip < 0.2) return;
    const d = t - HIT[i];
    if (i === 0) {                                          // crown sparkle
      const sp = d - 0.32;
      burst(K, 22, PH.y + 18, sp, { n: 10, r0: 40, r1: 110, color: C.red, lw: 5, dur: 0.34 });
    }
    if (i === 1) {                                          // phone ringing beside the head
      for (let k = 0; k < 3; k++) {
        const q = ((d - 0.12 - k * 0.13) % 0.42) / 0.42;
        if (d - 0.12 - k * 0.13 < 0 || d > 1.6) continue;
        K.save(); K.globalAlpha *= 1 - q; K.strokeStyle = C.red; K.lineWidth = 5; K.lineCap = 'round';
        for (const sx of [-1, 1]) { K.beginPath(); K.arc(sx * 30, PH.y + 86, 70 + q * 70, sx > 0 ? -0.5 : Math.PI - 0.5 + 1, sx > 0 ? 0.5 : Math.PI + 0.5); K.stroke(); }
        K.restore();
      }
    }
    if (i === 2) {                                          // megaphone blast: sound arcs + likes flying up-left out of the frame
      const ox = -BW / 2 + 40, oy = PH.y + 40;
      for (let k = 0; k < 3; k++) {
        const ph = d - 0.2 - k * 0.12; if (ph < 0) continue;
        const q = (ph % 0.45) / 0.45;
        K.save(); K.globalAlpha *= (1 - q) * clamp(1.4 - d * 0.5); K.strokeStyle = C.red; K.lineWidth = 6; K.lineCap = 'round';
        K.beginPath(); K.arc(ox + 40, oy + 40, 40 + q * 120, Math.PI * 1.05, Math.PI * 1.45); K.stroke(); K.restore();
      }
      const r = rng(77);
      for (let k = 0; k < 6; k++) {
        const t0 = 0.26 + k * 0.1, q = (d - t0) / 0.75; if (q < 0 || q > 1) continue;
        const hx = ox - 30 - r() * 70 - q * 60, hy = oy - 10 - q * 230 - r() * 20, s = Math.sin(Math.PI * Math.min(1, q * 1.4)) * (0.8 + r() * 0.4);
        jbA([K], 1 - E.inCubic(q), () => X([K], hx, hy, s, (r() - 0.5) * 40, () => {
          circle(K, 0, 0, 24, C.red, C.ink, 3);
          K.save(); K.translate(0, 2); K.beginPath(); K.moveTo(0, 9); K.bezierCurveTo(-16, -2, -10, -14, 0, -6); K.bezierCurveTo(10, -14, 16, -2, 0, 9); K.fillStyle = '#FFFFFF'; K.fill(); K.restore();
        }));
      }
    }
    if (i === 3) {                                          // tickets pile out of the left edge
      const TK = ['#2041 refund?', '#2042 login', '#2043 bug', '#2044 urgent'];
      TK.forEach((s, k) => {
        const p = inAt(t, HIT[i] + 0.14 + k * 0.15, 3, 0.45); if (p <= 0.01) return;
        X([T, K], -BW / 2 - 40 + (1 - p) * 120 - (k % 2) * 16, 140 + k * 52, lerp(0.5, 1, clamp(p)), (k % 2 ? 6 : -5) * p, () => {
          T.save(); T.shadowColor = 'rgba(0,0,0,0.35)'; T.shadowBlur = 14; T.shadowOffsetY = 8; fillRR(T, -96, -21, 192, 42, 8, '#FFFFFF'); T.restore();
          fillRR(K, -96, -21, 192, 42, 8, '#FFFFFF'); strokeRR(K, -96, -21, 192, 42, 8, C.ink, 3);
          fillRR(K, -96, -21, 10, 42, 4, C.red);
          text(K, s, -76, 8, { font: F.mono, weight: 700, size: 20, color: C.ink, align: 'left' });
        });
      });
      const n = d < 0.15 ? 1 : d < 0.3 ? 3 : d < 0.45 ? 5 : d < 0.6 ? 8 : 12, bp = inAt(t, HIT[i] + 0.12, 3, 0.4);
      if (bp > 0.01) X([K], BW / 2 - 24, PH.y + 18, bp * (1 + ring(d - 0.6, 4, 8) * 0.15), 0, () => {
        circle(K, 0, 0, 26, C.red, C.ink, 3); text(K, String(n), 0, 9, { font: F.grot, weight: 700, size: 26, color: '#FFFFFF' });
      });
    }
  }

  // ── the whole hanging badge i (pivot on the line) ──
  function hanging(T, K, i, t) {
    const q = pend(i, t); if (!q || t >= DEP[i]) return null;
    const fl = i < 4 ? Math.cos(TAU * E.inOutCubic(P(t, T_FLIP[i], 0.42))) : 1;
    X([T, K], q.hx, q.hy, 1, q.th, () => jbA([T, K], q.a, () => {
      jbRibbon(K, q.L);
      X([T, K], 0, q.L + 6, q.sc, 0, () => {
        for (const c of [T, K]) { c.save(); c.scale(1 + q.sq * 0.6, 1 - q.sq); }
        // landing glow (classic red dots)
        jbGlow(T, 0, BH / 2, 300, 0.55 * Math.exp(-Math.max(0, t - HIT[i]) * 3.5) * (t >= HIT[i] ? 1 : 0));
        badge(T, K, i, t, { flip: fl });
        extras(T, K, i, t, fl);
        for (const c of [T, K]) c.restore();
      });
    }));
    return q;
  }
  // after the snap: the badge is sucked into its roster pill
  function flying(T, K, i, t) {
    if (t < DEP[i] || t > ARR[i]) return;
    const q0 = pend(i, DEP[i]), [x0, y0] = badgeCentre(q0), [x1, y1] = pillC(i);
    const k = clamp((t - DEP[i]) / FLY[i]), u = E.inBack(k) * 0.92 + k * 0.08;
    const cx = Math.min(x0, x1) - 140, cy = lerp(y0, y1, 0.35);
    const v = 1 - u, px = v * v * x0 + 2 * v * u * cx + u * u * x1, py = v * v * y0 + 2 * v * u * cy + u * u * y1;
    const s = lerp(1, 0.12, E.inCubic(k)), rot = q0.th + (i % 2 ? 1 : -1) * 260 * E.inCubic(k);
    const fl = i < 4 ? Math.cos(TAU * 1.5 * E.inCubic(k)) : 1;
    // speed streaks
    if (k > 0.35) jbA([K], 0.5 * (1 - k), () => line(K, px, py, lerp(px, x0, 0.25), lerp(py, y0, 0.25), C.red, 10 * s + 3));
    X([T, K], px, py, s, rot, () => jbA([T, K], 1 - clamp((k - 0.88) / 0.12), () => { K.translate(0, -BH / 2); T.translate(0, -BH / 2); badge(T, K, i, t, { flip: fl }); }));
  }
  // the snapped lanyard recoils up to the pin
  function recoil(K, i, t) {
    const d = t - DEP[i]; if (d < 0 || d > 0.3) return;
    const q = pend(i, DEP[i]), L = q.L * (1 - E.outCubic(d / 0.3));
    X([K], q.hx, lineY(q.hx, t), 1, q.th * (1 - d / 0.3) + Math.sin(d * 40) * 8 * (1 - d / 0.3), () => {
      fillRR(K, -7, 0, 14, L, 3, C.red); line(K, -7, 2, -7, Math.max(2, L - 2), C.ink, 2, 'butt'); line(K, 7, 2, 7, Math.max(2, L - 2), C.ink, 2, 'butt');
    });
  }

  function drawLine(T, K, t) {
    if (t < T_LINE || t >= T_GONE) return;
    const [xa, xb] = lineSpan(t); if (xb - xa < 2) return;
    const pts = []; for (let x = xa; x <= xb; x += 16) pts.push([x, lineY(x, t)]); pts.push([xb, lineY(xb, t)]);
    const wob = (x) => Math.sin(x * 0.02 - t * 40) * 10 * Math.exp(-(t - T_LINE) * 7) * (t < T_LINE + 0.6 ? 1 : 0);
    T.save(); T.strokeStyle = '#9A9A9A'; T.lineWidth = 6; T.lineCap = 'round'; T.beginPath(); pts.forEach(([x, y], k) => k ? T.lineTo(x + 6, y + 14 + wob(x)) : T.moveTo(x + 6, y + 14 + wob(x))); T.stroke(); T.restore();
    K.save(); K.strokeStyle = C.ink; K.lineWidth = 5; K.lineCap = 'round'; K.beginPath(); pts.forEach(([x, y], k) => k ? K.lineTo(x, y + wob(x)) : K.moveTo(x, y + wob(x))); K.stroke(); K.restore();
    // pins clip on left → right
    const order = [0, 3, 1, 4, 2];
    order.forEach((i, n) => {
      const x = HX[i]; if (x < xa || x > xb) return;
      const p = inAt(t, T_YOU + 0.02 + n * 0.055, 3.2, 0.42), out = clamp((t - (i === 4 ? DEP[4] : DEP[i]) - 0.05) / 0.12);
      const s = p * (1 - E.inBack(out));
      jbPin(K, x, lineY(x, t) + 2, s);
      if (t < HIT[i] - FALL[i]) {                          // empty slot: a dashed ghost tag waiting for its job
        const g = clamp((t - T_YOU - 0.1 - n * 0.055) / 0.15);
        jbA([K], g * 0.55, () => { K.save(); K.setLineDash([8, 8]); K.lineDashOffset = -t * 30; strokeRR(K, x - 34, lineY(x, t) + 30, 68, 92, 10, C.ink, 2.5); K.restore(); });
      }
    });
  }

  function rosterBump(t) {
    if (t >= 6.9 || t < HATS[0]) return 0;
    let b = 0;
    for (let i = 0; i < 4; i++) b += 0.035 * ring(t - HATS[i], 3, 9);
    for (let i = 0; i < 5; i++) b += 0.03 * ring(t - ARR[i], 3.5, 10);
    return b * clamp((6.9 - t) / 0.12);
  }

  SC.jobs = {
    label: '// 02 — jobs', bg: 'light',
    cam: t => ({ x: 0, y: 0, z: 1 + 0.022 * win(t, 3.3, 6.42, 0.9, 0.36), r: 0 }),
    draw(T, K, t) {
      // overload: the warm glow behind the stage grows with every job
      const load = t < HATS[0] ? 0 : HATS.filter(h => t >= h).length / 5;
      const ga = 0.18 * load * win(t, 3.3, 6.45, 0.4, 0.35) + 0.12 * win(t, 5.5, 6.3, 0.2, 0.3) * (0.5 + 0.5 * Math.sin(t * 22));
      jbGlow(T, 540, 760, 640, ga);
      // roster (through-object), bumps as each job lands / is filed into it
      const b = rosterBump(t);
      if (b === 0) roster(T, K, RO.x, RO.y, RO.s, { t });
      else { const cx = RO.x + RO_W / 2, cy = RO.y + RO_H / 2; X([T, K], cx, cy, 1 + b, 0, () => roster(T, K, -RO_W / 2, -RO_H / 2, RO.s, { t })); }
      // job pop flashes on the roster pills
      for (let i = 0; i < 5; i++) {
        const [px, py] = pillC(i);
        shock(K, px, py, t - ARR[i], { r: 56, color: C.red, lw: 5, dur: Math.min(0.3, SETTLE - ARR[i]) });
        if (i < 4) burst(K, px, py, t - HATS[i] - 0.02, { n: 8, r0: 34, r1: 74, color: C.red, lw: 4, dur: 0.26 });
      }
      if (t < T_LINE || t >= SETTLE) return;
      drawLine(T, K, t);
      for (let i = 0; i < 5; i++) recoil(K, i, t);
      // row 2 (long strings) behind row 1
      for (const i of [3, 4, 0, 1, 2]) hanging(T, K, i, t);
    },
    front(T, K, t) {
      if (t < DEP[0] || t >= SETTLE) return;
      for (const i of [0, 1, 2, 3, 4]) flying(T, K, i, t);
    },
    guy(t) {
      const d = PRESENTER_DOCK;
      const chaos = win(t, 5.96, 6.42, 0.12, 0.3);
      const L = [  // look targets per beat
        [3.0, 3.36, -0.25, -0.75], [3.36, 3.85, -0.75, -0.6], [3.85, 4.62, -0.45, -0.7], [4.62, 5.28, 0.05, -0.9],
        [5.28, 5.96, -0.75, -0.35], [5.96, 6.45, -0.45, -0.3]];
      let lx = 0, ly = 0;
      for (const [a, b, x, y] of L) { const w = win(t, a, b, 0.12, 0.2); lx += x * w; ly += y * w; }
      return Object.assign({ x: d.x, y: d.y, s: d.s },
        arms(t, [[T_YOU - 0.06, HATS[0] - 0.02, 'L', 'point', { pointAng: -100 }],
          [HATS[1] - 0.04, HATS[2] - 0.2, 'R', 'thumb'],
          [HATS[2] - 0.04, HATS[3] - 0.12, 'R', 'point', { pointAng: -104 }],
          [HATS[3] + 0.02, 5.9, 'LR', 'shrug'],
          [6.04, 6.42, 'R', 'fist']]),
        expr(t, [[3.0, 3.36, { smile: 0.4, brow: 0.55 }],
          [3.36, 3.85, { smile: 0.8, brow: 0.35 }],
          [3.85, 4.62, { smile: 0.95, brow: 0.2 }], [4.02, 4.18, { wink: 1 }],
          [4.62, 5.28, { smile: 0.5, brow: 0.75 }],
          [5.28, 5.96, { smile: -0.25, brow: 0.5, browTilt: 0.6, sweat: 0.5 }],
          [5.96, 6.45, { shock: 0.6, sweat: 1, browTilt: 0.85, smile: -0.35 }]]),
        { lookX: lx, lookY: ly, headTurn: 0.32 * Math.sin(TAU * 3.4 * (t - 5.96)) * chaos + 0.12 * lx,
          headTilt: -5 * win(t, 3.36, 3.85, 0.1, 0.2) + 5 * win(t, 4.62, 5.28, 0.1, 0.2) - 4 * win(t, 5.28, 5.96, 0.1, 0.2) });
    },
  };
})();
