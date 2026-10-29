// ── ILLUSTRATED EXAMPLE · A PHONE THAT REALLY PLAYS A REEL (studied from two reels that showed "the reel this skill makes" inside a
// phone; de-branded: a made-up 5-shot edit "the corner shop always wins", generic handle, no real UI copied)
// WHAT it shows: whenever a reel/video/ad/TikTok appears ON SCREEN in your reel, it must look like a real video PLAYING: shots cut
// every ~1 s, the edit's own camera kicks and whips, word captions pop, a voice waveform scrolls, a tiny presenter talks, a progress
// bar runs. Never a static thumbnail card.
// TECHNIQUES inside (guides/illustration.md "The playing phone"):
//   · a LOOP clocked by the ABSOLUTE reel time (illustrate.js shotClock(t, shots, loop, off)): the little edit keeps playing
//     seamlessly across your scene cuts; `off` picks which shot is on screen at a given moment of YOUR reel
//   · shots = [{id, t0, cut}] → one small drawer per shot, d = time into the shot; every shot has its own entrance (slam, pins
//     dropping, coins arcing) so each cut is a visible change
//   · shotCam: entry move per cut type ('kick' zoom bump, 'zoom' punch-in, 'whip' pan + whipStreaks) + a zoom kick on every accent word
//   · the edit is built from the SAME illustrate.js primitives as the hero props (isoBox, isoSlab, isoCar, isoPerson, litWindow...),
//     at small scale: u = screen width / 400 keeps every size relative to the phone
//   · layers L = {hook, scene, voice, caps, play} each 0..1 so the phone can be BUILT on your words (headline types in → scene
//     springs up → voice + presenter → captions → app overlay), then plays (scene = 1)
//   · voice: reelCaption (words pop 0.13 s apart), voiceWave (bars peak on the word onsets), miniGuy (the reel's own presenter,
//     lip-synced, a pose per shot); reelOverlay (generic short-video UI, no invented like counts)
// API: playingMiniReel(ctx, t, x, y, w, h, L) draws the screen into a rect (use it as phone() content) ·
//      miniReelPhone(T, K, t, cx, cy, w, o) a phone playing it, o: { L, r (deg), s, off }
// DON'T paste this edit: build YOUR reel's mini edit from YOUR props with the same loop/camera/caption pattern. Not loaded by the
// engine. Needs kits/illustrate.js.

var PMR_LOOP = 5.6, PMR_OFF = 0.4;
var PMR_SHOTS = [
  { id: 'shop', t0: 0.0, cut: 'kick' },       // hook: the corner shop slams onto its tile, dust + burst
  { id: 'street', t0: 1.1, cut: 'whip' },     // the street: walkers stream past, every one passes the shop
  { id: 'map', t0: 2.2, cut: 'zoom' },        // a city map: pins drop on every corner
  { id: 'coins', t0: 3.3, cut: 'cut' },       // coins arc from the pavement into the till
  { id: 'end', t0: 4.6, cut: 'zoom', dark: true },   // ink end card: the word draws on
];
var PMR_CAPS = [[0.04, 'THE CORNER'], [0.36, '*SHOP'], [0.62, 'ALWAYS *WINS.'], [1.15, 'EVERY *WALKER'], [1.6, 'PASSES IT.'],
  [2.25, 'ON EVERY'], [2.55, '*CORNER.'], [3.35, 'FOOT TRAFFIC'], [3.8, 'IS *MONEY.'], [4.65, 'IT’S THE'], [4.95, '*LOCATION.']].map(([t0, s]) => ({ t0, words: s.split(' ').map(w => ({ s: w.replace('*', ''), hot: w[0] === '*' })) }));
PMR_CAPS.forEach((c, i) => { c.t1 = i + 1 < PMR_CAPS.length ? PMR_CAPS[i + 1].t0 : PMR_LOOP; });
var PMR_ONSETS = [], PMR_HOT = [];
PMR_CAPS.forEach(c => c.words.forEach((w, k) => { PMR_ONSETS.push(c.t0 + k * 0.13); if (w.hot) PMR_HOT.push(c.t0 + k * 0.13); }));
var PMR_POSE = { shop: { pointAng: -40, smile: 0.5, brow: 0.5 }, street: { armL: 'present', pointAng: -30, smile: 0.6 }, map: { armL: 'frame', armR: 'frame', pointAng: -42, smile: 0.7 },
  coins: { pointAng: -50, armR: 'fist', smile: 0.9 }, end: { pointAng: -50, armR: 'thumb', smile: 1, wink: 1 } };

function pmrRays(K, cx, cy, t, col, R) { K.save(); K.translate(cx, cy); K.rotate(t * 0.3); K.fillStyle = col; for (let i = 0; i < 12; i++) { K.beginPath(); K.moveTo(0, 0); K.arc(0, 0, R, i * TAU / 12, i * TAU / 12 + TAU / 24); K.closePath(); K.fill(); } K.restore(); }
// the shop on its little tile (iso units, origin = tile centre)
function pmrShop(K, t) {
  isoSlab(K, -70, -60, 70, 60, 8, { shadow: true });
  isoQuad(K, -70, 34, 70, 60, 0, '#D8D3C9');
  isoCastShadow(K, -40, -36, 30, 24, 40, 0.2);
  isoBox(K, -40, -36, 30, 24, 0, 46, '#E9DCC6', { edge: 'rgba(80,60,40,0.45)', lw: 1.3 });
  isoLeft(K, 24, () => { K.fillStyle = '#2F6B5A'; K.fillRect(-40, -46, 70, 8); litWindow(K, -34, -26, 34, 20, { seed: 2, mull: 11 }); fillRR(K, 6, -27, 12, 27, 1, '#3A2A20'); awning(K, -36, -36, 40, 7, ['#2F6B5A', '#FFF6E6'], { n: 6 }); });
  isoRight(K, 30, () => { K.fillStyle = '#245446'; K.fillRect(-24, -46, 60, 8); litWindow(K, -16, -28, 26, 18, { seed: 6, people: false, mull: 13 }); });
  isoTree(K, 50, -40, 0.9, { t });
}
function pmrMoney(K, x, y, r, t, k) {
  X([K], x, y, 1, 0, () => { K.scale(Math.max(0.18, Math.abs(Math.cos(t * 3.2 + k * 1.3))), 1); circle(K, 0, 0, r, '#FFD84D', '#8A6400', r * 0.17); text(K, '$', 0, r * 0.42, { font: F.grot, weight: 700, size: r * 1.2, color: '#5A4100' }); });
}
// ── the 5 shots (screen coords; g = {x, y, w, h, u, cx}; d = time into the shot) ──
var PMR_DRAW = {
  shop(K, d, t, g) {
    const { y, h, u, cx } = g, gy = y + 0.66 * h;
    pmrRays(K, cx, y + 0.5 * h, t, '#ECE7DB', 480 * u);
    const fall = d < 0.16 ? 1 - (d / 0.16) ** 2 : 0, sq = d >= 0.16 ? ring(d - 0.16, 5, 8) * 0.07 : 0;
    X([K], cx, gy - fall * 160 * u, 1.6 * u, 0, () => { K.scale(1 + sq, 1 - sq); pmrShop(K, t); });
    if (d > 0.16 && d < 0.5) burst(K, cx, y + 0.5 * h, d - 0.16, { n: 12, r0: 150 * u, r1: 200 * u, color: C.ink, lw: 5 * u, dur: 0.3 });
  },
  street(K, d, t, g) {
    const { y, h, u, cx } = g, z = 1.25 + 0.1 * clamp(d);
    X([K], cx, y + 0.6 * h, z * u, 0, () => {
      isoSlab(K, -150, -70, 150, 70, 10);
      isoQuad(K, -150, 20, 150, 70, 0, '#4A4D55'); isoPath(K, [[-150, 45], [150, 45]], 0, '#F4D35E', 1.6, { dash: [8, 7] });
      isoQuad(K, -150, 8, 150, 20, 0, '#D8D3C9');
      [[-130, -90, '#D9C7A8'], [-78, -36, '#C9D2D6'], [-24, 30, '#E9DCC6']].forEach(([a, b, c], i) => { isoBox(K, a, -60, b, 4, 0, 40 + i * 6, c, { edge: true, lw: 1 }); isoLeft(K, 4, () => litWindow(K, a + 6, -24, b - a - 12, 16, { seed: i + 3, mull: 9 })); });
      for (let k = 0; k < 6; k++) { const xx = -140 + ((t * 40 + k * 52) % 280); isoPerson(K, xx, 14, 0.6, { ph: t * 12 + k, shirt: ['#D8402F', '#3E6D8E', '#2F6B5A'][k % 3] }); }
      isoCar(K, 140 - ((t * 70) % 290), 32, 'x', '#3F6FB5');
    });
  },
  map(K, d, t, g) {
    const { x, y, w, h, u, cx } = g, mx = x + 18 * u, my = y + 0.27 * h, mw = w - 36 * u, mh = 0.46 * h;
    fillRR(K, mx + 5 * u, my + 8 * u, mw, mh, 22 * u, 'rgba(40,30,20,0.16)'); fillRR(K, mx, my, mw, mh, 22 * u, '#EDE6D6');
    K.save(); rr(K, mx, my, mw, mh, 22 * u); K.clip();
    const z = lerp(1.4, 1.0, E.outCubic(clamp(d / 0.9))), S = 62 * u;
    K.translate(cx, my + mh / 2); K.scale(z, z); K.rotate(-9 * D2R);
    K.fillStyle = '#CFE3B4'; K.fillRect(-S + 6 * u, S * 0.5, S - 12 * u, S - 12 * u);
    K.strokeStyle = '#FFFFFF'; K.lineWidth = 9 * u;
    for (let i = -6; i <= 6; i++) { K.beginPath(); K.moveTo(i * S, -6 * S); K.lineTo(i * S, 6 * S); K.stroke(); K.beginPath(); K.moveTo(-6 * S, i * S); K.lineTo(6 * S, i * S); K.stroke(); }
    [[-2, -1], [0, -2], [1, 0], [-1, 1], [2, 1], [0, 2], [-2, 2], [2, -2]].forEach(([i, j], k) => {
      const dd = d - 0.1 - k * 0.06; if (dd <= 0) return;
      const fall = 1 - E.outCubic(clamp(dd / 0.16)), s = u * 1.1 * clamp(pop(dd, 3, 0.45), 0, 1.25) / z;
      K.save(); K.translate(i * S, j * S - fall * 70 * u); K.rotate(9 * D2R); K.scale(s, s);
      softShadow(K, 2, 1, 9, 3.2, 0.25);
      K.beginPath(); K.moveTo(0, 0); K.bezierCurveTo(-5, -9, -15, -17, -15, -29); K.arc(0, -29, 15, Math.PI, 0); K.bezierCurveTo(15, -17, 5, -9, 0, 0); K.closePath();
      K.fillStyle = k === 2 ? C.red : '#2F6B5A'; K.fill(); K.lineWidth = 2.6; K.strokeStyle = '#FFFFFF'; K.stroke(); circle(K, 0, -29, 5.5, '#FFFFFF');
      K.restore();
    });
    K.restore();
  },
  coins(K, d, t, g) {
    const { y, h, u, cx } = g, sy = y + 0.6 * h;
    X([K], cx + 40 * u, sy, 1.25 * u, 0, () => pmrShop(K, t));
    for (let k = 0; k < 6; k++) {
      const q = (d * 1.6 - k * 0.17); if (q < 0) continue;
      const f = q % 1, ax = cx - 150 * u, ay = sy + 40 * u, bx = cx + 10 * u, by = sy - 40 * u;
      const px = lerp(ax, bx, E.inOutCubic(f)), py = lerp(ay, by, E.inOutCubic(f)) - Math.sin(f * Math.PI) * 120 * u;
      K.save(); K.globalAlpha *= clamp(f / 0.1) * clamp((1 - f) / 0.1); pmrMoney(K, px, py, 15 * u, t, k); K.restore();
    }
  },
  end(K, d, t, g) {
    const { x, y, w, h, u, cx } = g, cy = y + 0.5 * h;
    K.fillStyle = '#15161A'; K.fillRect(x, y, w, h); pmrRays(K, cx, cy, -t, '#1E2026', 560 * u);
    const p = E.outCubic(clamp(d / 0.4)), f = { font: F.serif, italic: true, weight: 400, size: 96 * u, color: C.red };
    K.save(); K.beginPath(); K.rect(x, cy - 100 * u, w * p, 160 * u); K.clip(); text(K, 'location.', cx, cy + 20 * u, f); K.restore();
    if (d > 0.4) for (let k = 0; k < 5; k++) { const tw = Math.max(0, Math.sin(t * 5 + k * 1.7)); if (tw > 0.05) sparkle4(K, cx + (-140 + k * 70) * u, cy - (90 + 30 * hash(k)) * u + (k % 2) * 180 * u, 10 * u * tw, '#FFFFFF'); }
    if (d < 0.12) { K.save(); K.globalAlpha *= 0.75 * (1 - d / 0.12); K.fillStyle = '#FFFFFF'; K.fillRect(x, y, w, h); K.restore(); }
  },
};
// headline typed at the top of the reel (hook layer): "The corner shop / always *wins*."
function pmrHeadline(K, t, x, y, w, h, u, hk, dark) {
  const A = 'The corner shop', B = 'always', Cw = 'wins.';
  const fA = { font: F.grot, weight: 700, size: 34 * u, color: dark ? '#FFFFFF' : C.ink, align: 'left' };
  const fB = { font: F.serif, weight: 400, size: 50 * u, italic: true, color: C.red, align: 'left' };
  const tot = A.length + B.length + Cw.length + 2, n = Math.floor(hk * tot + 1e-6);
  const nA = Math.min(n, A.length), nB = clamp(n - A.length - 1, 0, B.length), nC = clamp(n - A.length - B.length - 2, 0, Cw.length);
  const wA = measure(K, A, fA), wB = measure(K, B, fA), wC = measure(K, Cw, fB), cx = x + w / 2, y1 = y + 0.118 * h, y2 = y1 + 52 * u, x2 = cx - (wB + 11 * u + wC) / 2;
  if (nA > 0) text(K, A.slice(0, nA), cx - wA / 2, y1, fA);
  if (nB > 0) text(K, B.slice(0, nB), x2, y2, fA);
  if (nC > 0) { const bp = nC >= Cw.length ? 1 + 0.045 * Math.sin(t * 5.2) : 1; X([K], x2 + wB + 11 * u + wC / 2, y2 - 14 * u, bp, 0, () => text(K, Cw.slice(0, nC), -wC / 2, 14 * u, fB)); }
  if (hk < 1 && Math.floor(t * 4) % 2 === 0) fillRR(K, cx + wA / 2 + 4 * u, y1 - 30 * u, 3.5 * u, 36 * u, 1.5 * u, C.ink);
}
function playingMiniReel(K, t, x, y, w, h, L = {}) {
  const u = w / 400, cx = x + w / 2;
  K.fillStyle = '#F3F1EA'; K.fillRect(x, y, w, h);
  const hk = clamp(L.hook || 0), sc = clamp(L.scene || 0), vp = clamp(L.voice || 0), cp = clamp(L.caps || 0), pl = clamp(L.play || 0);
  if (hk + sc + vp + cp + pl <= 0) return;
  const clk = shotClock(t, PMR_SHOTS, PMR_LOOP, L.off == null ? PMR_OFF : L.off), playing = sc >= 1, sh = clk.sh, dark = playing && !!sh.dark, g = { x, y, w, h, u, cx };
  K.save(); K.beginPath(); K.rect(x, y, w, h); K.clip();
  if (playing) {
    const cm = shotCam(clk.lt, PMR_SHOTS, w, { hot: PMR_HOT });
    if (!dark) { K.save(); K.beginPath(); K.rect(x, y + 0.222 * h, w, h); K.clip(); }        // shots stay clear of the headline
    K.save(); K.translate(cx + cm.dx, y + 0.5 * h); K.scale(cm.z, cm.z); K.translate(-cx, -(y + 0.5 * h));
    PMR_DRAW[sh.id](K, clk.d, t, g);
    K.restore();
    if (!dark) K.restore();
    whipStreaks(K, x, y, w, h, cm.whip, sh.i * 7.3);
  } else if (sc > 0) {                                                       // building: the shop springs up under a drifting camera
    const gy = y + h * 0.66, lp = E.outBack(clamp(sc * 2.2));
    pmrRays(K, cx, y + 0.5 * h, t, '#ECE7DB', 480 * u * clamp(sc * 3));
    X([K], cx + Math.sin(t * 0.8) * 8 * u, gy, 1.6 * u * lp, Math.sin(t * 0.7) * 1.5, () => { K.save(); K.scale(1, E.outBack(clamp((sc - 0.2) / 0.5))); pmrShop(K, t); K.restore(); });
  }
  if (hk > 0) pmrHeadline(K, t, x, y, w, h, u, hk, dark);
  const capY = y + h * lerp(0.80, 0.765, pl), waveY = y + h * lerp(0.90, 0.868, pl);
  if (vp > 0) miniGuy(K, t, x + 0.81 * w, y + h + 4 * u + (1 - E.outBack(clamp(vp))) * 170 * u, 0.17 * u, PMR_POSE[playing ? sh.id : 'shop']);
  if (cp > 0) {
    const s = cp < 1 ? clamp(pop(cp * 0.6, 3, 0.45), 0, 1.3) : 1;
    if (playing) { const c = PMR_CAPS.find(q => clk.lt >= q.t0 && clk.lt < q.t1); if (c) reelCaption(K, cx - 0.035 * w, capY, u, w * 0.72, c.words, clk.lt - c.t0, { scale: s, dark }); }
    else reelCaption(K, cx - 0.035 * w, capY, u, w * 0.72, PMR_CAPS[1].words, 1, { scale: s });
  }
  if (vp > 0) voiceWave(K, t, clk.lt, x + 0.07 * w, x + 0.66 * w, waveY, u, PMR_ONSETS, { dark, p: vp });
  if (pl > 0) reelOverlay(K, t, x, y, w, h, u, { a: pl, handle: '@yourhandle' });
  if (playing) {
    const pc = pl > 0.5 || dark ? '#FFFFFF' : C.ink;
    fillRR(K, x, y + h - 5 * u, w, 5 * u, 0, pl > 0.5 || dark ? 'rgba(255,255,255,0.3)' : 'rgba(17,17,17,0.12)');
    fillRR(K, x, y + h - 5 * u, w * clk.p, 5 * u, 0, pc);
  }
  K.restore();
}
// a phone playing it (engine phone(): halftone shadow on T, frame + screen on K)
function miniReelPhone(T, K, t, cx, cy, w, o = {}) {
  X([T, K], cx, cy, o.s || 1, o.r || 0, () => phone(T, K, 0, 0, w, (K2, x, y, ww, hh) => playingMiniReel(K2, t, x, y, ww, hh, Object.assign({ hook: 1, scene: 1, voice: 1, caps: 1, play: 1 }, o.L || {}, { off: o.off }))));
}
