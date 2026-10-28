// Automatic captions from build/words.json. Two styles (reel.json captions.style: 'auto' | 'box' | 'pill'):
//
//  'box'  (studio default) Figtree 72 px at the top (y 250), groups of <= 4 words a line and <= 2 lines; each word pops
//         in when it is said (expo ease, blur 14 -> 0, 18 px rise); the word being said is bold white, words already said
//         go grey (#6b6b6b), and ONE key word per group wears a blue selection box (rgba(42,122,252,.2) fill, 3 px #2a7afc
//         inset border, two round blue handles). One group on screen at a time; it leaves 0.12 s before the next group.
//  'pill' (city default) a dark glass pill low on the frame (y 1432): the chunk's words are grey until said, then white.
//
// Key words come from reel.json captions.keys (lower-case, punctuation ignored). The first key word in a group gets the box.
const BLUE = '#2a7afc';
const FONT = "Figtree, Inter, Fallback, sans-serif";

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const prog = (t, t0, d) => clamp((t - t0) / d);
const outExpo = (x) => (x >= 1 ? 1 : x <= 0 ? 0 : 1 - Math.pow(2, -10 * x));
const easeOut = (k) => 1 - Math.pow(1 - k, 3);
export const bare = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function groupPhrase(words, CAP) {
  const width = (w) => w.s.length + 1 + (w.key ? 4 : 0);
  const lines = []; let cur = [], n = 0;
  for (const w of words) {
    if (cur.length && (cur.length >= CAP.perLine || n + width(w) > CAP.chars)) { lines.push(cur); cur = []; n = 0; }
    cur.push(w); n += width(w);
    if (/[,.!?"”:;]$/.test(w.s)) { lines.push(cur); cur = []; n = 0; }
  }
  if (cur.length) lines.push(cur);
  const chars = (l) => l.reduce((n, w) => n + width(w), 0);
  const out = [];
  for (let i = 0; i < lines.length; i += 2) {
    const a = lines[i], b = lines[i + 1];
    if (!b) out.push(a);
    else if (/[.!?]$/.test(a[a.length - 1].s)) { out.push(a); i--; }        // never join across a sentence end
    else if (chars(a) + chars(b) <= CAP.chars) out.push([...a, ...b]);
    else out.push([...a, { ...b[0], br: true }, ...b.slice(1)]);
  }
  return out.map((g) => { let boxed = false; return g.map((w) => { if (!w.key) return w; if (boxed) return { ...w, key: false }; boxed = true; return w; }); });
}

export class Captions {
  constructor(root, words, cfg = {}) {
    this.CAP = { x: 120, w: 840, size: cfg.size || 72, perLine: 4, chars: 22, y: cfg.y ?? 250, pillY: cfg.pillY ?? 1432 };
    const keys = new Set((cfg.keys || []).map(bare));
    const ws = words.map((w) => ({ t: w.s, e: w.e, s: String(w.w).replace(/[—–]/g, '-'), key: keys.has(bare(w.w)) }));
    this.groups = groupPhrase(ws, this.CAP);
    // box style element
    const el = document.createElement('div');
    Object.assign(el.style, { position: 'absolute', left: this.CAP.x + 'px', top: this.CAP.y + 'px', width: this.CAP.w + 'px', display: 'flex', flexWrap: 'wrap',
      justifyContent: 'center', alignItems: 'center', rowGap: '0px', fontFamily: FONT, fontSize: this.CAP.size + 'px', lineHeight: 1.04,
      letterSpacing: '-0.5px', color: '#fff', pointerEvents: 'none' });
    el.dir = 'auto';   // right-to-left scripts flow right-to-left (flex order follows the direction)
    root.appendChild(el); this.el = el;
    // pill style element
    const pill = document.createElement('div');
    pill.style.cssText = `position:absolute;left:50%;top:${this.CAP.pillY}px;transform:translateX(-50%);max-width:900px;padding:16px 30px 18px;border-radius:22px;`
      + `background:rgba(16,19,25,.84);color:#fff;font:700 50px Inter, Fallback, sans-serif;letter-spacing:-.01em;line-height:1.18;text-align:center;white-space:nowrap;opacity:0;pointer-events:none`;
    pill.dir = 'auto';
    root.appendChild(pill); this.pill = pill;
    // pill chunks: break after punctuation or at 4 words / 24 chars
    const chunks = []; let cur = [];
    for (const w of words) {
      cur.push(w);
      const txt = cur.map((x) => x.w).join(' ');
      if (/[.,?!:;]$/.test(w.w) || cur.length >= 4 || txt.length >= 24) { chunks.push(cur); cur = []; }
    }
    if (cur.length) chunks.push(cur);
    this.chunks = chunks.map((ws) => ({ ws, s: ws[0].s, e: ws[ws.length - 1].e }));
    this._chunk = -1; this._lastBox = '';
  }

  // opts: { style: 'box'|'pill', dy, hide, theme: 'dark'|'light' }
  update(t, opts = {}) {
    const style = opts.style || 'box';
    if (opts.hide) { this.clearBox(); this.pill.style.opacity = 0; return; }
    if (style === 'pill') { this.clearBox(); this.drawPill(t, opts); }
    else { this.pill.style.opacity = 0; this.drawBox(t, opts); }
  }
  clearBox() { if (this._lastBox) { this.el.innerHTML = ''; this._lastBox = ''; } }

  drawBox(t, opts) {
    const el = this.el, CAP = this.CAP;
    el.style.top = (CAP.y + (opts.dy || 0)) + 'px';
    let gi = -1;
    for (let k = 0; k < this.groups.length; k++) if (t >= this.groups[k][0].t) gi = k;
    if (gi < 0) { this.clearBox(); return; }
    const g = this.groups[gi], next = this.groups[gi + 1];
    const to = next ? next[0].t - 0.12 : g[g.length - 1].e + 1.2;
    const gfade = 1 - clamp((t - to) / 0.1);
    if (gfade <= 0) { this.clearBox(); return; }
    const light = opts.theme === 'light';
    const FG = light ? '#141820' : '#ffffff', DIM = light ? '#8d929b' : '#6b6b6b';
    let cur = -1; g.forEach((w, i) => { if (t >= w.t) cur = i; });
    const size = CAP.size;
    let html = '';
    g.forEach((w, i) => {
      if (w.br && t >= w.t) html += '<div style="flex-basis:100%;height:0"></div>';
      const dt = t - w.t; if (dt < 0) return;
      const p = outExpo(prog(dt, 0, 0.14));
      const past = i < cur;
      const color = past && !w.key ? DIM : FG;
      const weight = i === cur || w.key ? 700 : 500;
      let inner = `<span style="color:${color};display:inline-block;font-weight:${weight}">${esc(w.s)}</span>`;
      if (w.key) {
        const bp = outExpo(prog(dt, 0.05, 0.25));
        const hs = size * 0.3;
        inner = `<span style="position:relative;display:inline-block;padding:0 ${size * 0.18}px">`
          + `<span style="position:absolute;inset:${-size * 0.06}px ${-size * 0.02}px;border-radius:6px;background:rgba(42,122,252,0.2);box-shadow:inset 0 0 0 3px ${BLUE};transform:scale(${0.6 + 0.4 * bp});opacity:${bp}"></span>`
          + `<span style="position:absolute;width:${hs}px;height:${hs}px;border-radius:999px;background:${BLUE};box-shadow:0 0 0 3px #fff;left:${-size * 0.16}px;top:${-size * 0.2}px;transform:scale(${bp})"></span>`
          + `<span style="position:absolute;width:${hs}px;height:${hs}px;border-radius:999px;background:${BLUE};box-shadow:0 0 0 3px #fff;right:${-size * 0.16}px;bottom:${-size * 0.16}px;transform:scale(${bp})"></span>`
          + `<span style="position:relative">${inner}</span></span>`;
      }
      html += `<span style="display:inline-flex;align-items:center;opacity:${p};filter:blur(${((1 - p) * 14).toFixed(2)}px);transform:translateY(${((1 - p) * 18).toFixed(2)}px);margin-right:${size * 0.32}px">${inner}</span>`;
    });
    if (html !== this._lastBox) { el.innerHTML = html; this._lastBox = html; }
    el.style.opacity = gfade;
  }

  drawPill(t, opts) {
    let idx = -1;
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i], next = this.chunks[i + 1];
      const end = next ? Math.min(next.s, c.e + 0.6) : c.e + 0.8;
      if (t >= c.s - 0.05 && t < end) { idx = i; break; }
    }
    if (idx < 0) { this.pill.style.opacity = 0; return; }
    const c = this.chunks[idx];
    if (idx !== this._chunk) {
      this._chunk = idx;
      this.pill.innerHTML = c.ws.map((w) => `<span>${esc(String(w.w).replace(/[—–]/g, '-'))}</span>`).join(' ');
      this._spans = [...this.pill.querySelectorAll('span')];
    }
    c.ws.forEach((w, i) => { this._spans[i].style.color = t >= w.s - 0.03 ? '#fff' : 'rgba(255,255,255,.38)'; });
    const k = clamp((t - c.s + 0.05) / 0.14);
    this.pill.style.opacity = 1;
    this.pill.style.top = (this.CAP.pillY + (opts.dy || 0)) + 'px';
    this.pill.style.transform = `translateX(-50%) translateY(${(1 - easeOut(k)) * 10}px) scale(${0.97 + 0.03 * easeOut(k)})`;
  }
}
