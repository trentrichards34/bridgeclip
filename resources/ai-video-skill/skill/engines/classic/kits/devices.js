// ───────────────────────── devices kit: phone, browser window, terminal, app panel ─────────────────────────
// All draw in the caller's space. Drop shadows go on T (they print as halftone dots), surfaces + type on K.
// Wrap in X([T, K], x, y, s, rot, () => ...) to animate position / scale / rotation.

// phone mock centred at (x, y), width w (height = w·16/9 + bezel). content(K, x0, y0, w, h) is drawn clipped to the screen.
// o: { frame: '#0C0D0E', screen: '#FFFFFF', shadow: true, notch: true }
function phone(T, K, x, y, w, content, o = {}) {
  const h = w * 16 / 9 + w * 0.06, x0 = x - w / 2, y0 = y - h / 2, r = w * 0.13, b = w * 0.035;
  if (T && o.shadow !== false) { T.save(); T.shadowColor = 'rgba(0,0,0,0.45)'; T.shadowBlur = 40; T.shadowOffsetY = 22; fillRR(T, x0, y0, w, h, r, '#FFFFFF'); T.restore(); }
  fillRR(K, x0, y0, w, h, r, o.frame || '#0C0D0E');
  K.save(); rr(K, x0 + b, y0 + b, w - 2 * b, h - 2 * b, r - b); K.clip();
  K.fillStyle = o.screen || '#FFFFFF'; K.fillRect(x0, y0, w, h);
  if (content) content(K, x0 + b, y0 + b, w - 2 * b, h - 2 * b);
  K.restore();
  if (o.notch !== false) fillRR(K, x - w * 0.14, y0 + b + w * 0.03, w * 0.28, w * 0.07, w * 0.035, '#000');
  return { x: x0 + b, y: y0 + b, w: w - 2 * b, h: h - 2 * b };
}
// phone status bar + app header inside a phone screen (use from phone's content callback)
function phoneHeader(K, x, y, w, title, o = {}) {
  const s = w / 400;
  text(K, o.time || '9:41', x + 34 * s, y + 38 * s, { font: F.grot, weight: 700, size: 17 * s, color: C.ink, align: 'left' });
  fillRR(K, x + w - 64 * s, y + 25 * s, 30 * s, 14 * s, 4 * s, C.ink);
  if (title) text(K, title, x + w / 2, y + 96 * s, { font: F.grot, weight: 700, size: 26 * s, color: C.ink });
  line(K, x, y + 124 * s, x + w, y + 124 * s, HAIR, 2, 'butt');
  return y + 124 * s;
}

// light browser window (x, y = top-left). o: { url, tab, t, dark, r } ; content(K, x, y, w, h) clipped to the page area
function browser(T, K, x, y, w, h, content, o = {}) {
  const bar = 92, r = o.r ?? 22;
  uiCard(T, K, x, y, w, h, { r });
  K.save(); rr(K, x, y, w, h, r); K.clip();
  K.fillStyle = '#F1EFEA'; K.fillRect(x, y, w, bar);
  [0, 1, 2].forEach(i => circle(K, x + 30 + i * 24, y + 26, 7.5, i === 0 ? C.red : '#CFCBC2'));
  // tab
  const tf = { font: F.grot, weight: 500, size: 19 }, tw = Math.min(w * 0.45, measure(K, o.tab || uiText('newTab'), tf) + 70);
  fillRR(K, x + 108, y + 10, tw, 36, 10, '#FFFFFF');
  circle(K, x + 128, y + 28, 7, C.red);
  text(K, o.tab || uiText('newTab'), x + 144, y + 35, Object.assign({ color: C.ink, align: 'left' }, tf));
  // url bar
  fillRR(K, x + 20, y + 52, w - 40, 32, 16, '#FFFFFF');
  text(K, o.url || 'example.com', x + 46, y + 74, { font: F.grot, weight: 500, size: 18, color: '#6b6861', align: 'left' });
  line(K, x, y + bar, x + w, y + bar, HAIR, 2, 'butt');
  K.fillStyle = o.page || '#FFFFFF'; K.fillRect(x, y + bar, w, h - bar);
  K.save(); K.beginPath(); K.rect(x, y + bar, w, h - bar); K.clip();
  if (content) content(K, x, y + bar, w, h - bar);
  K.restore();
  K.restore();
  strokeRR(K, x, y, w, h, r, HAIR, 3);
  return { x, y: y + bar, w, h: h - bar };
}

// app panel: white card with a "// label ............ right" mono header and a hairline (the reference-card look)
// content(K, x, y, w, h) gets the area below the header. o: { label, right, dot: true, r, dark }
function panel(T, K, x, y, w, h, content, o = {}) {
  const dark = !!o.dark, head = o.head ?? 64, r = o.r ?? 28;
  uiCard(T, K, x, y, w, h, { r, fill: dark ? '#111214' : '#FFFFFF', border: dark ? '#111214' : HAIR });
  if (o.dot !== false) circle(K, x + 32, y + 32, 8, C.red);
  if (o.label) text(K, '// ' + o.label, x + 52, y + 40, { font: F.mono, weight: 500, size: 21, color: dark ? '#8F8F8F' : '#8a8780', align: 'left' });
  if (o.right) text(K, o.right, x + w - 28, y + 40, { font: F.mono, weight: 500, size: 20, color: dark ? '#8F8F8F' : '#8a8780', align: 'right' });
  line(K, x, y + head, x + w, y + head, dark ? '#26272B' : 'rgba(17,17,17,0.09)', 2, 'butt');
  K.save(); rr(K, x, y, w, h, r); K.clip(); K.beginPath(); K.rect(x, y + head, w, h - head); K.clip();
  if (content) content(K, x, y + head, w, h - head);
  K.restore();
  return { x, y: y + head, w, h: h - head };
}

// dark terminal / AI-agent session window. lines: [{ t0, txt, kind, cps, dur, done }]
//   kind: cmd ("> " typed at cps) · ai (accent bullet, fast type) · ok (✓) · warn (✗ accent) · spin (spinner until t0+dur, then ✓ done) · dim · blank
// o: { t, title, input: { txt, t0, cps, ph }, status: [left, right], fs, lh, pad }
const TERM = { bg: '#15161A', bar: '#1D1E23', line: '#2A2C33', text: '#E9E9EC', dim: '#8B8D94', ok: '#79D08A', font: '"JetBrains Mono"' };
function terminal(T, K, x, y, w, h, o = {}) {
  const t = o.t ?? 0, fs = o.fs ?? 24, lh = o.lh ?? fs * 1.42, pad = o.pad ?? 26, bar = 50;
  T.save(); T.shadowColor = 'rgba(0,0,0,0.45)'; T.shadowBlur = 44; T.shadowOffsetY = 26; fillRR(T, x, y, w, h, 22, '#FFFFFF'); T.restore();
  fillRR(K, x, y, w, h, 22, TERM.bg);
  K.save(); rr(K, x, y, w, h, 22); K.clip();
  K.fillStyle = TERM.bar; K.fillRect(x, y, w, bar);
  line(K, x, y + bar, x + w, y + bar, TERM.line, 2, 'butt');
  [0, 1, 2].forEach(i => circle(K, x + 28 + i * 26, y + bar / 2, 8, i === 0 ? C.red : '#4A4C53'));
  text(K, o.title || 'terminal — ~/project', x + w / 2, y + bar / 2 + 7, { font: TERM.font, weight: 500, size: 19, color: TERM.dim });
  let cy = y + bar + pad;
  const bodyTop = cy, inputH = o.input ? 78 : 0, statusH = o.status ? 34 : 0, bodyBottom = y + h - pad - inputH - statusH;
  const rows = (o.lines || []).filter(l => t >= l.t0).map(l => termRow(l, t));
  const scroll = Math.max(0, rows.length * lh - (bodyBottom - cy));
  K.save(); K.beginPath(); K.rect(x, bodyTop - 4, w, bodyBottom - bodyTop + 8); K.clip();
  rows.forEach((r, i) => {
    const ry = cy + (i + 0.8) * lh - scroll;
    if (ry < bodyTop - lh || ry > bodyBottom + lh) return;
    const age = t - r.l.t0;
    K.save(); K.globalAlpha *= clamp(age / 0.12); K.translate(0, (1 - E.outCubic(clamp(age / 0.18))) * 10);
    let cx = x + pad;
    if (r.prefix) { text(K, r.prefix, cx, ry, { font: TERM.font, weight: 700, size: fs, color: r.pcol, align: 'left' }); cx += measure(K, r.prefix, { font: TERM.font, weight: 700, size: fs }); }
    let txt = r.txt; const avail = x + w - pad - cx, tf = { font: TERM.font, weight: r.bold ? 700 : 500, size: fs };
    if (measure(K, txt, tf) > avail) { while (txt.length > 1 && measure(K, txt + '…', tf) > avail) txt = txt.slice(0, -1); txt += '…'; }
    text(K, txt, cx, ry, Object.assign({ color: r.col, align: 'left' }, tf));
    if (r.caret) caretAt(K, cx + measure(K, txt, tf), ry, fs * 1.05, t, TERM.text);
    K.restore();
  });
  K.restore();
  if (o.input) {
    const iy = y + h - pad - statusH - 62, inp = o.input;
    strokeRR(K, x + pad, iy, w - pad * 2, 62, 12, '#44464E', 2);
    const typed = inp.t0 !== undefined ? typedStr(inp.txt, t, inp.t0, inp.cps || 30) : (inp.txt || '');
    text(K, '>', x + pad + 20, iy + 40, { font: TERM.font, weight: 700, size: fs, color: TERM.dim, align: 'left' });
    if (typed) text(K, typed, x + pad + 52, iy + 40, { font: TERM.font, weight: 500, size: fs, color: TERM.text, align: 'left' });
    else if (inp.ph) text(K, inp.ph, x + pad + 52, iy + 40, { font: TERM.font, weight: 500, size: fs, color: '#5C5E66', align: 'left' });
    caretAt(K, x + pad + 52 + measure(K, typed, { font: TERM.font, weight: 500, size: fs }), iy + 40, fs * 1.05, t, TERM.text);
  }
  if (o.status) {
    const sy = y + h - pad + 2;
    text(K, o.status[0] || '', x + pad + 4, sy, { font: TERM.font, weight: 500, size: fs * 0.66, color: TERM.dim, align: 'left' });
    text(K, o.status[1] || '', x + w - pad - 4, sy, { font: TERM.font, weight: 500, size: fs * 0.66, color: TERM.dim, align: 'right' });
  }
  K.restore();
}
const SPIN = ['✻', '✶', '✳', '✢', '·', '✢', '✳', '✶'];
function termRow(l, t) {
  const age = t - l.t0;
  switch (l.kind) {
    case 'cmd': { const s = typedStr(l.txt, t, l.t0, l.cps || 30); return { l, prefix: '> ', pcol: TERM.dim, txt: s, col: TERM.text, caret: s.length < l.txt.length }; }
    case 'ai': return { l, prefix: '⏺ ', pcol: C.red, txt: typedStr(l.txt, t, l.t0, l.cps || 90), col: TERM.text };
    case 'ok': return { l, prefix: '✓ ', pcol: TERM.ok, txt: l.txt, col: TERM.text };
    case 'warn': return { l, prefix: '✗ ', pcol: C.red, txt: l.txt, col: C.red, bold: true };
    case 'spin': {
      if (age >= (l.dur ?? 1)) return { l, prefix: '✓ ', pcol: TERM.ok, txt: l.done || l.txt, col: TERM.text };
      return { l, prefix: SPIN[Math.floor(t * 12) % SPIN.length] + ' ', pcol: C.red, txt: l.txt + '.'.repeat(1 + Math.floor(t * 3) % 3), col: C.red };
    }
    case 'dim': return { l, txt: '  ' + l.txt, col: TERM.dim };
    case 'blank': return { l, txt: '', col: TERM.dim };
    default: return { l, txt: l.txt, col: l.col || TERM.dim };
  }
}
// small inline code chip (dark), left-aligned at x, centred on y; returns width
function codeChip(K, str, x, y, o = {}) {
  const size = o.size || 26, f = { font: F.mono, weight: 700, size }, w = measure(K, str, f) + 32, hh = size * 1.75;
  fillRR(K, x, y - hh / 2, w, hh, 10, o.fill || TERM.bg);
  text(K, str, x + 16, y + size * 0.36, Object.assign({ color: o.color || TERM.text, align: 'left' }, f));
  return w;
}
// skeleton text lines (grey bars) for "content" inside windows: rows of widths (px) at x, y with gap
function skeleton(K, x, y, widths, o = {}) {
  const { h = 16, gap = 30, col = '#E6E3DC' } = o;
  widths.forEach((w, i) => fillRR(K, x, y + i * gap, w, h, h / 2, i === 0 && o.dark ? '#2A2B30' : col));
}
