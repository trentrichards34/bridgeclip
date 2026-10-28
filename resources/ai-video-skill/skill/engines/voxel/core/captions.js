// captions.js: word-synced captions + the taped paper headline strip, plain DOM over the WebGL canvas.
// Captions: words are grouped (<= 3 words / 16 chars, punctuation ends a group) and shown 1 group at a time near the bottom
// (block top y = 1470 px); each word appears the moment it is said, the word being said is the "hot" one.
// Style: the speech bubble: white comic bubble, thick ink border, tail alternating left/right, Nunito 900 74px, hot word #e2553a.
// Headline: one cream paper strip (#f1e7d2) with two tape pieces at top 118 px, Nunito 900 50-60 px capitals,
// re-slapped whenever the beat's head text changes.
import { rng } from './util.js';

const CAP = { y: 1470, size: 90, maxWords: 3, maxChars: 16 };
// font stacks go inside style="..." attributes: single quotes only
const ROUND = "Nunito, Fallback, 'Arial Black'";

// deterministic torn edge (used by the headline strip): a polygon with small jagged steps along all four sides
function torn(seed, amp = 4) {
  const R = rng(seed), pts = [];
  const side = (n, f) => { for (let i = 0; i <= n; i++) pts.push(f(i / n, (R() - 0.5) * amp)); };
  side(7, (k, j) => `${(k * 100).toFixed(1)}% ${(Math.abs(j) * 0.9).toFixed(1)}px`);
  side(3, (k, j) => `calc(100% - ${Math.abs(j).toFixed(1)}px) ${(k * 100).toFixed(1)}%`);
  side(7, (k, j) => `${(100 - k * 100).toFixed(1)}% calc(100% - ${(Math.abs(j) * 0.9).toFixed(1)}px)`);
  side(3, (k, j) => `${Math.abs(j).toFixed(1)}px ${(100 - k * 100).toFixed(1)}%`);
  return `polygon(${pts.join(',')})`;
}

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const backOut = (k, s = 2.2) => 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2);


// paper fibre noise as a data URL (static, deterministic), shared by scraps and the headline strip
function paperNoise() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), R = rng(11), img = g.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (R() - 0.5) * 70;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 40;
  }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 90; i++) {   // fibres
    g.strokeStyle = `rgba(${R() > 0.5 ? 255 : 0},${R() > 0.5 ? 255 : 0},${R() > 0.5 ? 255 : 0},0.05)`;
    g.lineWidth = 0.6 + R(); g.beginPath();
    const x = R() * 256, y = R() * 256, a = R() * 6.28, l = 6 + R() * 22;
    g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  return c.toDataURL();
}

// ----- caption style: the speech bubble -----
// Each takes the current group g (words with .t start, .show text), the time t and the group index, and returns HTML.
const CORAL = '#ff7a4f', INKD = '#1d1a16';
const hotIndex = (g, t) => { let c = -1; g.forEach((w, i) => { if (t >= w.t - 0.02) c = i; }); return c; };
const said = (g, t) => g.filter((w) => t >= w.t - 0.02);

const STYLES = {
  // 4 · Speech bubble: the line sits in a white comic bubble with a tail, so the narration reads like the little people talking
  4(g, t, gi) {
    const cur = hotIndex(g, t), k = clamp((t - g[0].t + 0.02) / 0.2), s = 0.6 + 0.4 * backOut(k, 2.4);
    const left = gi % 2 === 0;
    const words = said(g, t).map((w, i) => `<span style="color:${i === cur ? '#e2553a' : INKD};margin:0 10px">${w.show}</span>`).join('');
    return `<div style="position:relative;transform:scale(${s.toFixed(3)}) rotate(${left ? -1.5 : 1.5}deg);transform-origin:${left ? '20%' : '80%'} 120%">`
      + `<div style="background:#fff;border:7px solid ${INKD};border-radius:56px;padding:14px 40px 18px;box-shadow:0 14px 0 rgba(0,0,0,.25);font:900 74px ${ROUND};letter-spacing:-1px;white-space:nowrap">${words}</div>`
      + `<div style="position:absolute;bottom:-44px;${left ? 'left:70px' : 'right:70px'};width:0;height:0;border-left:30px solid transparent;border-right:30px solid transparent;border-top:50px solid ${INKD};transform:skewX(${left ? 18 : -18}deg)"></div>`
      + `<div style="position:absolute;bottom:-28px;${left ? 'left:79px' : 'right:79px'};width:0;height:0;border-left:21px solid transparent;border-right:21px solid transparent;border-top:36px solid #fff;transform:skewX(${left ? 18 : -18}deg)"></div></div>`;
  },
};

function groupWords(words, CAP) {
  const groups = []; let cur = [], n = 0;
  for (const w of words) {
    if (cur.length && (cur.length >= CAP.maxWords || n + w.s.length > CAP.maxChars)) { groups.push(cur); cur = []; n = 0; }
    cur.push(w); n += w.s.length + 1;
    if (/[,.!?]$/.test(w.s)) { groups.push(cur); cur = []; n = 0; }
  }
  if (cur.length) groups.push(cur);
  return groups;
}

export class Captions {
  // opts: { y (block top px), maxWords, maxChars }
  constructor(root, words, opts = {}) {
    this.style = 4;   // one caption style: the speech bubble
    this.cap = { ...CAP, ...Object.fromEntries(Object.entries({ y: opts.y, maxWords: opts.maxWords, maxChars: opts.maxChars }).filter(([, v]) => v != null)) };
    this.noise = paperNoise();
    this.el = document.createElement('div');
    Object.assign(this.el.style, { position: 'absolute', left: '40px', right: '40px', top: this.cap.y + 'px', display: 'flex',
      justifyContent: 'center', alignItems: 'center', gap: '14px', flexWrap: 'wrap', pointerEvents: 'none' });
    this.el.dir = 'auto';   // right-to-left scripts flow right-to-left
    root.appendChild(this.el);
    // group on the raw words (punctuation ends a group), show them without trailing . and , (ref style)
    const esc = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const ws = words.map((w, i) => ({ t: w.s, e: w.e, i, s: w.w, show: esc(w.w.replace(/[.,;:]+$/, '').replace(/[\u2014"]/g, '')) }));
    this.groups = groupWords(ws, this.cap);
    this.lastKey = '';

    // headline
    this.head = document.createElement('div');
    Object.assign(this.head.style, { position: 'absolute', left: 0, right: 0, top: '118px', display: 'flex', justifyContent: 'center', pointerEvents: 'none' });
    this.head.dir = 'auto';
    root.appendChild(this.head);
    this.headText = null; this.headT0 = 0;
  }



  update(t, opts = {}) {
    this.el.style.top = (this.cap.y + (opts.dy || 0)) + 'px';
    let html = '';
    if (!opts.hide) {
      let gi = -1;
      for (let k = 0; k < this.groups.length; k++) if (t >= this.groups[k][0].t - 0.02) gi = k;
      if (gi >= 0) {
        const g = this.groups[gi], next = this.groups[gi + 1];
        const end = next ? next[0].t - 0.06 : g[g.length - 1].e + 1.0;
        if (t < end) {
          html = STYLES[4](g, t, gi);
        }
      }
    }
    if (html !== this.lastKey) { this.el.innerHTML = html; this.lastKey = html; }
  }

  // headline strip; text = beat's head (null hides). t = scene time.
  headline(text, t, t0) {
    if (text) text = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    this.headText = text; this.headT0 = t0;
    if (!text) { this.head.innerHTML = ''; return; }
    const k = clamp((t - this.headT0) / 0.22);
    const s = 1 + 0.12 * (1 - backOut(k, 1.8)), dy = -26 * (1 - backOut(k, 1.4));
    const len = text.length, fs = len > 26 ? 50 : len > 20 ? 54 : 60;
    const R = rng(text.length * 31 + text.charCodeAt(0));
    const rot = -1.4 + (R() - 0.5) * 1.2;
    const key = `${text}|${k.toFixed(3)}`;
    if (key === this.headKey) return; this.headKey = key;
    const tape = (side) => `<div style="position:absolute;top:-22px;${side}:-34px;width:96px;height:40px;background:rgba(214,198,150,.82) url(${this.noise});background-size:120px;`
      + `transform:rotate(${side === 'left' ? -38 : 38}deg);box-shadow:0 2px 3px rgba(0,0,0,.18);clip-path:${torn(side === 'left' ? 5 : 9, 6)}"></div>`;
    this.head.innerHTML = `<div style="position:relative;transform:translateY(${dy.toFixed(1)}px) rotate(${rot.toFixed(2)}deg) scale(${s.toFixed(3)});filter:drop-shadow(0 8px 10px rgba(0,0,0,.35))">`
      + `<div style="clip-path:${torn(3, 7)};background:#f1e7d2 url(${this.noise});background-size:200px;padding:22px 46px 18px;max-width:960px;`
      + `box-shadow:inset 0 0 40px rgba(150,120,70,.28);font-family:${ROUND};font-weight:900;font-size:${fs}px;letter-spacing:-0.5px;color:#1d1a16;white-space:nowrap">${text}</div>`
      + tape('left') + tape('right') + `</div>`;
  }
}
