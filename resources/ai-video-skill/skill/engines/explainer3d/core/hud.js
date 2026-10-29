// Screen-space layer over the 3D (ctx.hud). Immediate mode: call hud.* EVERY frame you want something visible;
// anything not called this frame fades out. Core calls begin() before scene updates and end() after the camera is placed,
// so labels pinned to 3D points never lag the camera.
//
//   hud.label(key, anchor, text, o)  label with a leader line pinned to a 3D point (Vector3 | [x,y,z]) or {x,y} screen px
//        o: { dx=60, dy=-90 (px offset), alpha, style: 'line'|'pill' (default by look), dark, color (swatch), small, sub,
//             size (scale), dot=true, line=true, align: 'center' }
//   hud.card(o)   glass info card at the top (alias hud.eta). o: { kicker, value, prev, k (0..1 digit roll prev -> value),
//                 unit, sub, state: 'live'|'ok'|'warn'|'bad'|'future'|'accent' or color: '#hex', icon: 'nav'|'tag'|'dot'|'bolt'|svg string,
//                 alpha, y (px, default 150), dy, scale }
//   hud.chip(o)   small status chip (alias hud.status). o: { label, color, alpha, x=64, y=1306 }
//   hud.big(key, text, o)  big screen type. o: { x=540, y=760, size=160, color, alpha, weight=800, sub, subColor, scale, mono, shadow }
//   hud.layer     a div for your own DOM (create in init, style in update, hide outside your window)
//   hud.project(v3) -> {x, y, behind}
import * as THREE from 'three';
import { P, C } from './palette.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const easeOut = (k) => 1 - Math.pow(1 - k, 3);
const backOut = (k, s = 1.70158) => 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2);
const MONO = "'JetBrains Mono', Fallback, monospace", SANS = "Inter, Fallback, sans-serif", FIG = "Figtree, Inter, Fallback, sans-serif";

const STATE = { live: C.live, ok: P.ok, warn: C.slow, bad: C.jam, future: C.forecast, accent: P.charge, route: C.route, past: C.history };
const ICONS = {
  nav: '<svg width="34" height="34" viewBox="0 0 24 24"><path d="M5 19 L12 4 L19 19 L12 15 Z" fill="#fff"/></svg>',
  tag: '<svg width="36" height="36" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="#fff"/><circle cx="12" cy="12" r="3" fill="none" stroke="#9aa3ad" stroke-width="1.4"/></svg>',
  dot: '<svg width="30" height="30" viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" fill="#fff"/><circle cx="12" cy="12" r="10" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="1.6"/></svg>',
  bolt: '<svg width="34" height="34" viewBox="0 0 24 24"><path d="M13 2 L5 13 h6 l-1 9 8-12 h-6 z" fill="#fff"/></svg>',
};

const CSS = `
.x3-card { position:absolute; left:50%; top:150px; transform:translateX(-50%); display:flex; align-items:center; gap:22px;
  padding:20px 34px 20px 24px; border-radius:34px; background:rgba(16,19,25,.86); color:#fff; opacity:0;
  box-shadow:0 18px 50px rgba(10,14,20,.28), inset 0 0 0 1.5px rgba(255,255,255,.07); white-space:nowrap; }
.x3-card .ic { width:64px; height:64px; border-radius:20px; display:grid; place-items:center; background:${C.route}; }
.x3-card .col { display:flex; flex-direction:column; gap:4px; }
.x3-card .kick { font:700 21px ${MONO}; letter-spacing:.16em; color:rgba(255,255,255,.55); display:flex; align-items:center; gap:10px; }
.x3-card .kick i { width:10px; height:10px; border-radius:50%; display:inline-block; }
.x3-card .row { display:flex; align-items:baseline; gap:14px; }
.x3-card .val { font:800 70px ${SANS}; letter-spacing:-.02em; line-height:1; display:flex; overflow:hidden; height:72px; font-variant-numeric:tabular-nums; }
.x3-card .val .d { display:inline-block; position:relative; height:72px; }
.x3-card .val .d span { display:block; height:72px; line-height:72px; }
.x3-card .unit { font:700 30px ${SANS}; color:rgba(255,255,255,.7); }
.x3-card .sub { font:600 24px ${SANS}; color:rgba(255,255,255,.55); margin-left:6px; }
.x3-chip { position:absolute; left:64px; top:1306px; display:flex; align-items:center; gap:14px; padding:13px 22px 13px 16px; opacity:0;
  border-radius:999px; background:rgba(16,19,25,.84); color:#fff; font:700 23px ${MONO}; letter-spacing:.12em; white-space:nowrap; }
.x3-chip i { width:14px; height:14px; border-radius:50%; display:inline-block; box-shadow:0 0 0 6px rgba(255,255,255,.08); }
.x3-lab { position:absolute; left:0; top:0; white-space:nowrap; opacity:0; }
.x3-lab.pill { padding:10px 18px 11px; border-radius:16px; font:700 30px ${MONO}; letter-spacing:.02em; color:${C.ink}; background:rgba(251,248,242,.94);
  box-shadow:0 8px 24px rgba(20,24,32,.16), inset 0 0 0 1.5px rgba(20,24,32,.08); }
.x3-lab.pill.dark { color:#fff; background:rgba(16,19,25,.86); }
.x3-lab.pill .sw { display:inline-block; width:12px; height:12px; border-radius:4px; margin-right:10px; vertical-align:1px; }
.x3-lab.pill small { font:600 20px ${SANS}; opacity:.6; margin-left:10px; letter-spacing:0; }
.x3-lab.line { font:600 42px ${FIG}; color:#fff; letter-spacing:.01em; line-height:1.15; text-shadow:0 2px 14px rgba(0,0,0,.6),0 0 5px rgba(0,0,0,.75); }
.x3-lab.line .s { font-weight:500; font-size:.72em; color:#9aa0aa; margin-top:4px; }
.x3-big { position:absolute; left:0; top:0; white-space:nowrap; font:800 160px ${FIG}; letter-spacing:-.04em; line-height:.9; text-align:center; opacity:0; }
`;

export class HUD {
  constructor(root, layer, camera) {
    this.root = root; this.camera = camera; this.layer = layer;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('width', 1080); this.svg.setAttribute('height', 1920);
    this.svg.style.cssText = 'position:absolute;inset:0;overflow:visible;pointer-events:none';
    root.appendChild(this.svg);
    this.pool = new Map(); this.bigs = new Map();
    this.v = new THREE.Vector3();
    this.look = 'studio';
    this.buildCard(); this.buildChip();
  }

  project(p) {
    const v = this.v.set(p.x, p.y, p.z).project(this.camera);
    return { x: (v.x + 1) / 2 * 1080, y: (1 - v.y) / 2 * 1920, behind: v.z > 1 || v.z < -1 };
  }

  begin(look) {
    this.look = look;
    for (const it of this.pool.values()) it.used = false;
    for (const it of this.bigs.values()) it.used = false;
    this._card = null; this._chip = null;
  }
  end() { this.drawCard(); this.drawChip(); this.drawLabels(); this.drawBigs(); }

  // ---------- card ----------
  buildCard() {
    const el = document.createElement('div'); el.className = 'x3-card';
    el.innerHTML = `<div class="ic"></div><div class="col"><div class="kick"><i></i><b></b></div><div class="row"><div class="val"></div><div class="unit"></div><div class="sub"></div></div></div>`;
    this.root.appendChild(el);
    this.cardEl = el; this.cVal = el.querySelector('.val'); this.cSub = el.querySelector('.sub'); this.cUnit = el.querySelector('.unit');
    this.cDot = el.querySelector('.kick i'); this.cKick = el.querySelector('.kick b'); this.cIc = el.querySelector('.ic');
    this._valKey = ''; this._icKey = '';
  }
  card(o) { this._card = o; }
  eta(o) { this._card = o ? { ...o, value: o.value ?? o.time } : o; }   // maps-reel name
  drawCard() {
    const o = this._card;
    if (!o || (o.alpha ?? 1) <= 0.001) { this.cardEl.style.opacity = 0; return; }
    const a = o.alpha ?? 1;
    this.cardEl.style.opacity = a;
    this.cardEl.style.top = (o.y ?? 150) + 'px';
    this.cardEl.style.transform = `translateX(-50%) translateY(${(1 - easeOut(clamp(a))) * -30 + (o.dy ?? 0)}px) scale(${o.scale ?? 1})`;
    const col = o.color || STATE[o.state || 'live'] || C.live;
    this.cDot.style.background = col;
    this.cKick.textContent = o.kicker ?? '';
    this.cSub.textContent = o.sub ?? '';
    this.cUnit.textContent = o.unit ?? '';
    const ic = o.icon ?? 'nav';
    if (ic !== this._icKey) { this._icKey = ic; this.cIc.innerHTML = ICONS[ic] || ic; this.cIc.style.display = ic ? 'grid' : 'none'; }
    this.cIc.style.background = o.iconColor || C.route;
    const cur = String(o.value ?? ''), prev = String(o.prev ?? cur), k = clamp(o.k ?? 1);
    const key = cur + '|' + prev;
    if (key !== this._valKey) {
      this._valKey = key;
      const n = Math.max(cur.length, prev.length);
      this.cVal.innerHTML = ''; this._digits = [];
      for (let i = 0; i < n; i++) {
        const a1 = prev[prev.length - n + i] ?? '', b1 = cur[cur.length - n + i] ?? '';
        const d = document.createElement('div'); d.className = 'd';
        d.innerHTML = `<span>${a1}</span><span>${b1}</span>`;
        this.cVal.appendChild(d); this._digits.push({ d, change: a1 !== b1, idx: i });
      }
    }
    const n = this._digits.length;
    for (const g of this._digits) {   // right-most digit rolls first
      const kk = g.change ? clamp((k - (n - 1 - g.idx) * 0.08) / 0.7) : 1;
      const e = g.change ? backOut(kk, 1.2) : 1;
      g.d.style.transform = `translateY(${-72 * e}px)`;
      g.d.style.color = g.change && kk < 1 ? (o.flash || '#fff') : '#fff';
    }
  }

  // ---------- chip ----------
  buildChip() {
    const el = document.createElement('div'); el.className = 'x3-chip'; el.innerHTML = '<i></i><b></b>';
    this.root.appendChild(el); this.chipEl = el; this.chipDot = el.querySelector('i'); this.chipTxt = el.querySelector('b');
  }
  chip(o) { this._chip = o; }
  status(o) { this._chip = o; }
  drawChip() {
    const o = this._chip;
    if (!o || (o.alpha ?? 1) <= 0.001) { this.chipEl.style.opacity = 0; return; }
    this.chipEl.style.opacity = o.alpha ?? 1;
    this.chipEl.style.left = (o.x ?? 64) + 'px'; this.chipEl.style.top = (o.y ?? 1306) + 'px';
    this.chipDot.style.background = o.color || C.live;
    this.chipTxt.textContent = o.label ?? '';
  }

  // ---------- labels ----------
  label(key, anchor, text, o = {}) {
    if (this.win && !o.keep && (this.t < this.win[0] - 0.001 || this.t > this.win[1] - 0.04)) return;   // outside its beat (e.g. during the whip)
    let it = this.pool.get(key);
    if (!it) {
      const el = document.createElement('div'); el.className = 'x3-lab'; this.root.appendChild(el);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      line.setAttribute('fill', 'none'); line.setAttribute('stroke-linecap', 'round'); line.setAttribute('stroke-linejoin', 'round');
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      this.svg.appendChild(line); this.svg.appendChild(ring); this.svg.appendChild(dot);
      it = { el, line, dot, ring, html: null, cls: '' }; this.pool.set(key, it);
    }
    it.used = true; it.anchor = anchor; it.o = o;
    const style = o.style || (this.look === 'city' ? 'pill' : 'line');
    const cls = 'x3-lab ' + style + (o.dark ? ' dark' : '');
    if (cls !== it.cls) { it.el.className = cls; it.cls = cls; it.w = null; }
    const html = style === 'pill'
      ? (o.color ? `<span class="sw" style="background:${o.color}"></span>` : '') + text + (o.small ? `<small>${o.small}</small>` : '')
      : `<div>${text}</div>` + (o.sub ? `<div class="s">${o.sub}</div>` : '');
    if (html !== it.html) { it.el.innerHTML = html; it.html = html; it.w = null; }
    it.style = style;
  }
  drawLabels() {
    for (const it of this.pool.values()) {
      const o = it.o || {};
      const a = it.used ? (o.alpha ?? 1) : 0;
      const off = () => { it.el.style.opacity = 0; it.line.setAttribute('opacity', 0); it.dot.setAttribute('opacity', 0); it.ring.setAttribute('opacity', 0); };
      if (a <= 0.001) { off(); continue; }
      const anc = it.anchor;
      const p = (anc.x !== undefined && anc.z === undefined && !Array.isArray(anc)) ? { x: anc.x, y: anc.y } : this.project(anc.isVector3 ? anc : new THREE.Vector3(anc[0], anc[1], anc[2]));
      if (p.behind) { off(); continue; }
      if (it.w == null) { it.w = it.el.offsetWidth; it.h = it.el.offsetHeight; }
      const dx = o.dx ?? 60, dy = o.dy ?? -90, k = easeOut(clamp(a));
      const lx = p.x + dx * k, ly = p.y + dy * k;
      const pill = it.style === 'pill';
      const gap = pill ? 0 : 10;
      let px = dx >= 0 ? lx + gap : lx - it.w - gap, py = ly - it.h / 2;
      if (o.align === 'center') px = lx - it.w / 2;
      const sw = it.w * (o.size ?? 1);                      // scaled width (size is a scale factor)
      if (dx < 0 && o.align !== 'center') px = lx - sw - gap;
      px = clamp(px, 40, 1080 - 40 - sw);
      it.el.style.opacity = a;
      it.el.style.transformOrigin = 'left center';
      it.el.style.transform = `translate(${px}px, ${py}px) scale(${o.size ?? 1})`;
      it.el.style.textAlign = dx >= 0 ? 'left' : 'right';
      const showLine = o.line !== false && Math.abs(dx) + Math.abs(dy) > 4;
      if (pill) {
        it.line.setAttribute('d', `M${p.x},${p.y} L${p.x},${ly} L${lx},${ly}`);
        it.line.setAttribute('stroke', o.lineColor || (o.dark ? 'rgba(16,19,25,.85)' : 'rgba(16,19,25,.55)')); it.line.setAttribute('stroke-width', 2.5);
        it.dot.setAttribute('r', 6); it.dot.setAttribute('fill', o.dotColor || o.color || C.ink); it.dot.setAttribute('stroke', '#fff'); it.dot.setAttribute('stroke-width', 3);
        it.ring.setAttribute('opacity', 0);
      } else {
        it.line.setAttribute('d', `M${p.x},${p.y} L${lx},${ly}`);
        it.line.setAttribute('stroke', o.lineColor || 'rgba(255,255,255,0.75)'); it.line.setAttribute('stroke-width', 2);
        it.dot.setAttribute('r', 6); it.dot.setAttribute('fill', o.dotColor || '#fff'); it.dot.setAttribute('stroke', 'none');
        it.ring.setAttribute('cx', p.x); it.ring.setAttribute('cy', p.y); it.ring.setAttribute('r', 13); it.ring.setAttribute('fill', 'none');
        it.ring.setAttribute('stroke', 'rgba(255,255,255,0.45)'); it.ring.setAttribute('stroke-width', 2); it.ring.setAttribute('opacity', o.dot === false ? 0 : a);
      }
      it.line.setAttribute('opacity', showLine ? a : 0);
      it.dot.setAttribute('cx', p.x); it.dot.setAttribute('cy', p.y); it.dot.setAttribute('opacity', o.dot === false ? 0 : a);
    }
  }

  // ---------- big type ----------
  big(key, text, o = {}) {
    let it = this.bigs.get(key);
    if (!it) { const el = document.createElement('div'); el.className = 'x3-big'; this.root.appendChild(el); it = { el, html: null }; this.bigs.set(key, it); }
    it.used = true; it.o = o;
    const html = text + (o.sub ? `<div style="font:700 ${Math.round((o.size ?? 160) * 0.2)}px ${MONO};letter-spacing:.14em;margin-top:18px;color:${o.subColor || (this.look === 'city' ? 'rgba(20,24,32,.55)' : 'rgba(255,255,255,.55)')}">${o.sub}</div>` : '');
    if (html !== it.html) { it.el.innerHTML = html; it.html = html; it.w = null; }
  }
  drawBigs() {
    for (const it of this.bigs.values()) {
      const o = it.o || {};
      const a = it.used ? (o.alpha ?? 1) : 0;
      if (a <= 0.001) { it.el.style.opacity = 0; continue; }
      const size = o.size ?? 160;
      if (it.size !== size || it.mono !== !!o.mono) { it.el.style.fontSize = size + 'px'; it.el.style.fontFamily = o.mono ? MONO : FIG; it.size = size; it.mono = !!o.mono; it.w = null; }
      it.el.style.fontWeight = o.weight ?? 800;
      it.el.style.color = o.color || (this.look === 'city' ? C.ink : '#fff');
      if (it.w == null) { it.w = it.el.offsetWidth; it.h = it.el.offsetHeight; }
      it.el.style.opacity = a;
      it.el.style.transform = `translate(${(o.x ?? 540) - it.w / 2}px, ${(o.y ?? 760) - it.h / 2}px) scale(${o.scale ?? 1})`;
      it.el.style.textShadow = o.shadow ?? (this.look === 'city' ? 'none' : '0 6px 40px rgba(0,0,0,.5)');
    }
  }
}
