// ───────────────────────── media: images, cover-fit, typing helpers ─────────────────────────
// Images live in the project's assets/ folder. Register them in a scene file BEFORE the page is ready:
//   ASSETS.push(['shot', 'assets/screenshot.png']);   →  IMG.shot (an HTMLImageElement) once READY resolves
// Every helper no-ops gracefully when an image is missing, so a scene never crashes on a bad path.
const IMG = {};
const ASSETS = [];
function loadImg(key, src) {                          // onload + timeout (decode() can hang under load)
  const im = new Image(); IMG[key] = im;
  return new Promise(res => { im.onload = () => res(); im.onerror = () => { console.warn('missing image ' + src); res(); }; setTimeout(res, 20000); im.src = src; });
}
// draw image covering box (x, y, w, h) with focus point fx, fy (0..1), optional zoom, corner radius r, grayscale
function coverImg(ctx, im, x, y, w, h, o = {}) {
  if (!im || !im.naturalWidth) return;
  const { fx = 0.5, fy = 0.4, zoom = 1, r = 0 } = o;
  const s = Math.max(w / im.naturalWidth, h / im.naturalHeight) * zoom;
  const dw = im.naturalWidth * s, dh = im.naturalHeight * s;
  ctx.save();
  if (r) { rr(ctx, x, y, w, h, r); ctx.clip(); } else { ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); }
  if (o.gray) ctx.filter = `grayscale(${o.gray}) brightness(${o.bright ?? 1})`;
  ctx.drawImage(im, x + (w - dw) * fx, y + (h - dh) * fy, dw, dh);
  ctx.restore();
}
// draw image fitted inside box (letterboxed), returns the drawn rect
function containImg(ctx, im, x, y, w, h) {
  if (!im || !im.naturalWidth) return null;
  const s = Math.min(w / im.naturalWidth, h / im.naturalHeight), dw = im.naturalWidth * s, dh = im.naturalHeight * s;
  ctx.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  return { x: x + (w - dw) / 2, y: y + (h - dh) / 2, w: dw, h: dh };
}
// typed prefix of str at time t (started at t0, cps characters per second)
function typedStr(str, t, t0, cps = 26) { return str.slice(0, Math.max(0, Math.min(str.length, Math.floor((t - t0) * cps)))); }
// typing that follows word timestamps: segs = [[str, t0, t1], ...] → the visible prefix at t
function typeSeg(t, segs) {
  let s = '';
  for (const [str, t0, t1] of segs) { if (t < t0) break; s += str.slice(0, Math.ceil(str.length * clamp((t - t0) / Math.max(0.01, t1 - t0)))); }
  return s;
}
// blinking text caret at (x, baseline y), height h
function caretAt(K, x, y, h, t, col = C.ink) { if (Math.floor(t * 2.4) % 2 === 0) fillRR(K, x + 3, y - h * 0.8, 3, h, 1.5, col); }
// four-point sparkle
function sparkle4(ctx, x, y, r, col = C.red) {
  ctx.save(); ctx.translate(x, y); ctx.beginPath();
  for (let i = 0; i < 4; i++) { const a = i * TAU / 4; ctx.quadraticCurveTo(0, 0, Math.cos(a) * r, Math.sin(a) * r); ctx.quadraticCurveTo(0, 0, Math.cos(a + TAU / 4) * r, Math.sin(a + TAU / 4) * r); }
  ctx.fillStyle = col; ctx.fill(); ctx.restore();
}
