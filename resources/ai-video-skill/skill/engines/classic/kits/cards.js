// ───────────────────────── cards kit: checklists, comments, DMs, chat, toasts, stats, toggles ─────────────────────────
// Local-coordinate helpers in the reference look: white cards, hairline borders, mono labels, accent for the one thing that matters.

// pill tag: left-aligned at x, centred on y; returns width. o: { fill, color, size, stroke, font }
function tag(K, str, x, y, o = {}) {
  const size = o.size || 22, f = { font: o.font || F.mono, weight: 700, size, ls: o.ls ?? 1 }, w = measure(K, str, f) + size * 1.3, h = size * 1.7;
  fillRR(K, x, y - h / 2, w, h, h / 2, o.fill || C.red);
  if (o.stroke) strokeRR(K, x, y - h / 2, w, h, h / 2, o.stroke, 2.5);
  text(K, str, x + w / 2, y + size * 0.36, Object.assign({ color: o.color || '#FFFFFF' }, f));
  return w;
}
// round avatar placeholder (no faces): ink circle + person glyph, or an image key
function avatar(K, x, y, r, o = {}) {
  if (o.img && IMG[o.img] && IMG[o.img].naturalWidth) { K.save(); K.beginPath(); K.arc(x, y, r, 0, TAU); K.clip(); coverImg(K, IMG[o.img], x - r, y - r, 2 * r, 2 * r); K.restore(); return; }
  circle(K, x, y, r, o.fill || '#E4DFD5'); person(K, x, y + r * 0.2, r / 52, o.ink || '#FFFFFF');
}
// toggle switch centred at x,y; on 0..1 (animate it)
function toggle(K, x, y, on, o = {}) {
  const w = o.w || 72, h = o.h || 40;
  fillRR(K, x - w / 2, y - h / 2, w, h, h / 2, on > 0.5 ? C.red : '#D9D5CC');
  circle(K, lerp(x - w / 2 + h / 2, x + w / 2 - h / 2, E.inOutCubic(clamp(on))), y, h / 2 - 5, '#FFFFFF');
}
// progress bar (x, y top-left), p 0..1
function progress(K, x, y, w, p, o = {}) {
  const h = o.h || 16;
  fillRR(K, x, y, w, h, h / 2, o.track || '#EDE9E0');
  if (p > 0) fillRR(K, x, y, Math.max(h, w * clamp(p)), h, h / 2, o.fill || C.red);
}

// checklist card. items: [{ txt, t0 (tick time), sub?, a? (0..1 row reveal) }] → rows tick (accent box + drawn check) at t0, done rows dim + strike
// o: { t, title, w, row: 86, strike: true, counter: true } ; returns height
function checklist(T, K, x, y, w, items, o = {}) {
  const t = o.t ?? 0, row = o.row || 86, head = o.title ? 78 : 18, h = head + items.length * row + 18;
  uiCard(T, K, x, y, w, h, { r: 28 });
  if (o.title) {
    uiLabel(K, o.title, x + 30, y + 48);
    if (o.counter !== false) { const n = items.filter(i => t >= i.t0).length; text(K, `${n}/${items.length}`, x + w - 30, y + 48, { font: F.mono, weight: 700, size: 24, color: n ? C.red : '#8a8780', align: 'right' }); }
    line(K, x, y + head - 12, x + w, y + head - 12, 'rgba(17,17,17,0.09)', 2, 'butt');
  }
  items.forEach((it, i) => {
    const ry = y + head + i * row + row / 2, d = t - it.t0, done = d >= 0;
    const ia = it.a ?? 1; if (ia <= 0.01) return;
    K.save(); K.globalAlpha *= clamp(ia); K.translate((1 - Math.min(1, ia)) * 60, 0);
    const fl = done ? Math.max(0, 1 - d / 0.45) : 0;
    if (fl > 0) fillRR(K, x + 12, ry - row / 2 + 6, w - 24, row - 12, 16, `rgba(255,59,31,${0.12 * fl})`);
    const bs = 44, bx = x + 30, by = ry - bs / 2, pp = done ? clamp(pop(d, 3, 0.45), 0, 1.25) : 0;
    X([K], bx + bs / 2, ry, done ? lerp(0.6, 1, Math.min(1, pp)) * (1 + 0.12 * ring(d, 3, 8)) : 1, 0, () => {
      if (done) fillRR(K, -bs / 2, -bs / 2, bs, bs, 12, C.red); else strokeRR(K, -bs / 2, -bs / 2, bs, bs, 12, '#CFCBC2', 3);
      if (done) check(K, 0, 0, bs * 0.62, clamp(d / 0.22), '#FFFFFF', 6);
    });
    const f = { font: F.grot, weight: 500, size: o.size || 36, ls: -0.5 }, tx = bx + bs + 26;
    text(K, it.txt, tx, ry + f.size * 0.34, Object.assign({ color: done && o.dim !== false ? '#8a8780' : C.ink, align: 'left' }, f));
    if (done && o.strike) line(K, tx - 4, ry + 2, tx + measure(K, it.txt, f) * E.outCubic(clamp((d - 0.1) / 0.25)) + 4, ry + 2, C.red, 4, 'round');
    if (it.sub) text(K, it.sub, x + w - 30, ry + 9, { font: F.mono, weight: 500, size: 20, color: '#8a8780', align: 'right' });
    if (i < items.length - 1) line(K, tx, ry + row / 2, x + w - 24, ry + row / 2, 'rgba(17,17,17,0.06)', 2, 'butt');
    K.restore();
  });
  return h;
}

// comment sheet with the CTA keyword: typed into the composer, posted as a glowing accent pill, replies stack under it.
// o: { t, keyword, tType, tSend, replies: [t,...], w } ; drawn with its top-left at (x, y); returns height
// Labels come from uiText('comments' | 'addComment' | 'post' | 'you') → reel.json "language" / "ui" (core/ui.js).
function commentSheet(T, K, x, y, o = {}) {
  const t = o.t ?? 0, w = o.w || 900, KW = String(o.keyword || 'REEL').toUpperCase(), HEAD = 84, ROW = 84, NROW = 3, INP = 104, h = HEAD + NROW * ROW + INP;
  const PF = { font: F.grot, weight: 700, size: 28, ls: 3 }, G = '#8a8780';
  const tType = o.tType ?? 0, tSend = o.tSend ?? 0.8, cps = o.cps || 16;
  const items = [{ skel: [300, 190] }, { skel: [220, 330] }, { you: true, t0: tSend }].concat((o.replies || []).map((rt, k) => ({ t0: rt, bg: k % 2 ? '#F0DDD6' : '#E4DFD5' })));
  const scr = items.reduce((a, it, k) => a + (k >= NROW && it.t0 !== undefined ? E.inOutCubic(P(t, it.t0, 0.24)) : 0), 0);
  uiCard(T, K, x, y, w, h, { r: 30 });
  fillRR(K, x + w / 2 - 36, y + 14, 72, 7, 3.5, '#DAD7CF');
  text(K, uiText('comments'), x + w / 2, y + 62, { font: F.grot, weight: 700, size: 30, color: C.ink });
  line(K, x, y + HEAD, x + w, y + HEAD, HAIR, 2, 'butt');
  const pill = (px, py, lit, k = 1) => {
    const pw = measure(K, KW, PF) + 36, ph = 44;
    X([K], px + pw / 2, py, k, 0, () => {
      if (lit) { K.save(); K.shadowColor = 'rgba(255,59,31,0.7)'; K.shadowBlur = 30; fillRR(K, -pw / 2, -ph / 2, pw, ph, ph / 2, C.red); K.restore(); }
      fillRR(K, -pw / 2, -ph / 2, pw, ph, ph / 2, lit ? C.red : '#FFFFFF'); strokeRR(K, -pw / 2, -ph / 2, pw, ph, ph / 2, C.red, 3);
      text(K, KW, 0, 10, Object.assign({ color: lit ? '#FFFFFF' : C.red }, PF));
    });
    return pw;
  };
  K.save(); K.beginPath(); K.rect(x, y + HEAD + 1, w, NROW * ROW); K.clip();
  items.forEach((it, k) => {
    const ry = y + HEAD + (k - scr) * ROW;
    if (ry < y + HEAD - ROW || ry > y + HEAD + NROW * ROW) return;
    if (it.t0 !== undefined && t < it.t0) return;
    const op = it.t0 === undefined ? 1 : E.outCubic(clamp((t - it.t0) / 0.2)), dy = (1 - op) * 22;
    K.save(); K.globalAlpha *= op;
    if (it.skel) {
      circle(K, x + 56, ry + ROW / 2 + dy, 25, '#E4DFD5');
      fillRR(K, x + 100, ry + 22 + dy, 120, 14, 7, '#E6E3DC'); fillRR(K, x + 100, ry + 46 + dy, it.skel[0], 16, 8, '#DDD9D1');
    } else if (it.you) {
      const fl = Math.max(0, 1 - (t - it.t0) / 0.5);
      if (fl > 0) fillRR(K, x + 12, ry + 4, w - 24, ROW - 8, 16, `rgba(255,59,31,${0.12 * fl})`);
      avatar(K, x + 56, ry + ROW / 2 + dy, 25, { fill: C.ink });
      const pw = pill(x + 100, ry + ROW / 2 + dy, true, 1 + 0.08 * ring(t - it.t0, 3, 7));
      text(K, uiText('you'), x + 100 + pw + 18, ry + ROW / 2 + 8 + dy, { font: F.mono, weight: 500, size: 22, color: G, align: 'left' });
    } else {
      circle(K, x + 56, ry + ROW / 2 + dy, 25, it.bg);
      pill(x + 100, ry + ROW / 2 + dy, false);
    }
    K.restore();
  });
  K.restore();
  // composer
  const POST = uiText('post'), postF = { font: F.grot, weight: 700, size: 29 }, postW = Math.max(74, measure(K, POST, postF));   // composer shrinks for long "Post" words
  const iy = y + h - INP, fx = x + 100, fw = w - 176 - postW, fy = iy + 20, fh = 64;
  line(K, x, iy, x + w, iy, HAIR, 2, 'butt');
  avatar(K, x + 56, iy + 52, 25, { fill: C.ink });
  const typing = t >= tType && t < tSend;
  fillRR(K, fx, fy, fw, fh, 32, '#FFFFFF'); strokeRR(K, fx, fy, fw, fh, 32, typing ? C.ink : HAIR, 3);
  const typed = t < tSend ? typedStr(KW, t, tType, cps) : '';
  if (!typed) text(K, uiText('addComment'), fx + 28, fy + 42, { font: F.grot, weight: 500, size: 28, color: '#b3b0a8', align: 'left' });
  else {
    const cf = { font: F.grot, weight: 700, size: 30, ls: 3 }, cw = measure(K, typed, cf) + 32;
    strokeRR(K, fx + 14, fy + fh / 2 - 23, cw, 46, 12, C.red, 3);
    text(K, typed, fx + 30, fy + fh / 2 + 11, Object.assign({ color: C.red, align: 'left' }, cf));
    caretAt(K, fx + 14 + cw + 6, fy + 45, 34, t, C.ink);
  }
  const press = win(t, tSend - 0.06, tSend + 0.04, 0.04, 0.12);
  X([K], x + w - 38 - postW / 2, fy + fh / 2, 1 - press * 0.15, 0, () => text(K, POST, 0, 10, { ...postF, color: typed.length === KW.length || t >= tSend ? C.red : '#C9C5BC' }));
  return h;
}

// chat / DM bubble (tail bottom-right). lines: [{ txt, t0 }] typed in; o: { t, w, title, tail: 'right'|'left', from }
// title: true = uiText('newMessage') ("new message" in the reel's language); a string = that text; omit = no header
function dmBubble(T, K, x, y, lines, o = {}) {
  if (o.title === true) o = Object.assign({}, o, { title: uiText('newMessage') });
  const t = o.t ?? 0, w = o.w || 660, head = o.title ? 70 : 24, lh = 56, h = head + lines.length * lh + 26, tailR = o.tail !== 'left';
  T.save(); T.shadowColor = 'rgba(0,0,0,0.42)'; T.shadowBlur = 46; T.shadowOffsetY = 26; fillRR(T, x, y, w, h, 34, '#FFFFFF'); T.restore();
  const tail = c => { c.beginPath(); const bx = tailR ? x + w : x, s = tailR ? 1 : -1; c.moveTo(bx - s * 70, y + h - 4); c.quadraticCurveTo(bx + s * 6, y + h + 10, bx + s * 30, y + h + 40); c.quadraticCurveTo(bx - s * 10, y + h + 26, bx - s * 130, y + h - 4); c.closePath(); };
  tail(T); T.fillStyle = '#FFFFFF'; T.fill();
  tail(K); K.lineWidth = 6; K.strokeStyle = HAIR; K.lineJoin = 'round'; K.stroke();
  strokeRR(K, x, y, w, h, 34, HAIR, 3);
  fillRR(K, x + 1.5, y + 1.5, w - 3, h - 3, 32.5, '#FFFFFF'); tail(K); K.fillStyle = '#FFFFFF'; K.fill();
  if (o.title) { circle(K, x + 40, y + 42, 7, C.red); text(K, o.title, x + 58, y + 50, { font: F.mono, weight: 500, size: 22, color: '#8a8780', align: 'left' }); }
  lines.forEach((l, i) => {
    if (t < l.t0) return;
    const s = typedStr(l.txt, t, l.t0, l.cps || 60);
    text(K, s, x + 30, y + head + (i + 0.75) * lh, { font: F.grot, weight: l.bold === false ? 500 : 700, size: l.size || 36, ls: -1, color: l.col || C.ink, align: 'left' });
  });
  return h;
}
// notification toast (top-left at x, y): accent dot + title + body; returns height
function toast(T, K, x, y, w, title, body, o = {}) {
  const h = body ? 120 : 84;
  uiCard(T, K, x, y, w, h, { r: 26 });
  fillRR(K, x + 24, y + 22, 40, 40, 11, o.icon || C.red);
  if (o.glyph) text(K, o.glyph, x + 44, y + 52, { font: F.grot, weight: 700, size: 26, color: '#FFFFFF' });
  text(K, title, x + 82, y + 50, { font: F.grot, weight: 700, size: 30, color: C.ink, align: 'left' });
  if (o.time) text(K, o.time, x + w - 26, y + 48, { font: F.mono, weight: 500, size: 20, color: '#8a8780', align: 'right' });
  if (body) text(K, body, x + 82, y + 92, { font: F.grot, weight: 500, size: 26, color: '#6b6861', align: 'left' });
  return h;
}
// stat card: label + big rolling number (bigFigure slot roll) + optional delta tag. p = roll progress 0..1
function statCard(T, K, x, y, w, h, label, value, p, o = {}) {
  uiCard(T, K, x, y, w, h, { r: 28 });
  uiLabel(K, label, x + 30, y + 50);
  bigFigure(K, value, x + 30, y + h - 44, o.size || 120, p, { align: 'left', color: o.color || C.ink });
  if (o.delta) tag(K, o.delta, x + w - 30 - measure(K, o.delta, { font: F.mono, weight: 700, size: 22, ls: 1 }) - 29, y + 44, {});
}
