// ───────────────────────── captions: kinetic headline built word by word from the voice ─────────────────────────
// Look: Space Grotesk 500, 84 px, -3% tracking, ink #111, left-aligned at x 130, first baseline y 330, wrap 800 px, line height 1.08.
// Emphasised words: Instrument Serif italic at 1.16x, accent colour, a small spring wobble when they land.
// Timing: each word appears 0.15 s BEFORE it is spoken (0.06 s fade + 14 px rise); the old phrase fades 0.2 s and lifts 40 px
// when the next phrase starts. A phrase never crosses a scene cut.
// PHRASES (optional, set in timeline.js): [[firstWordIdx, lastWordIdx, [emphasised word idxs], {size, maxW, swap: {idx: 'text'}}], ...]
// If PHRASES is null the engine phrases automatically (punctuation, pauses, ≤ 6 words, scene cuts) and emphasises words from
// reel.json captions.emphasize (or, failing that, numbers and the strongest content word of each phrase). Stop words and the
// "comment" words come from reel.json "language" (core/words.js LEX); an unknown language uses the word-length heuristic only.
let PHRASES = null, PHRASE_LIST = [], EMPH_TIMES = [];
const CAP = { size: 84, maxW: 800, x: 130, y: 330, lead: 0.3, maxWords: 6, color: null, emphasis: null };

function autoPhrases(cuts) {
  const em = new Set(((REEL.captions && REEL.captions.emphasize) || []).map(norm));
  const kw = REEL.cta && REEL.cta.keyword ? norm(REEL.cta.keyword) : null;     // the CTA keyword is always emphasised
  const out = [];
  let i0 = 0;
  const cutBefore = i => cuts.some(c => WORDS[i].s >= c - 0.02 && WORDS[i - 1].s < c - 0.02);
  for (let i = 0; i < WORDS.length; i++) {
    const w = WORDS[i].w, n = i - i0 + 1, last = i === WORDS.length - 1;
    let toEnd = 0; for (let k = i + 1; k < WORDS.length && k <= i + 3; k++) { toEnd++; if (/[.?!,;:]["”)]*$/.test(WORDS[k].w)) break; if (k === i + 3) toEnd = 9; }
    const full = n >= CAP.maxWords && !(toEnd <= 2 && n < CAP.maxWords + 2);   // never strand a 1-2 word tail ("a week.")
    const stop = /[.?!:;]["”)]*$/.test(w) || (/,$/.test(w) && n >= 3) || full || last
      || (WORDS[i + 1] && WORDS[i + 1].s - WORDS[i].e > 0.35) || (WORDS[i + 1] && cutBefore(i + 1));
    if (!stop) continue;
    // never leave a dangling 1-word phrase if the next sentence continues it (merge tiny tails into the next phrase)
    out.push([i0, i, []]); i0 = i + 1;
  }
  for (const p of out) {
    const idx = []; for (let i = p[0]; i <= p[1]; i++) idx.push(i);
    // the CTA keyword: when spoken in CAPS (any cased script) or within 3 words after a "comment" word of the reel's language
    const caps = w => { const c = w.replace(/[^\p{L}\p{N}]/gu, ''); return c.length >= 2 && c === c.toUpperCase() && c !== c.toLowerCase(); };
    const afterComment = i => { for (let k = Math.max(0, i - 3); k < i; k++) if (isCommentWord(WORDS[k].w)) return true; return false; };
    let pick = idx.filter(i => em.has(norm(WORDS[i].w)) || (kw && norm(WORDS[i].w) === kw && (caps(WORDS[i].w) || afterComment(i))));
    if (!pick.length && !em.size) {
      const nums = idx.filter(i => /\d/.test(WORDS[i].w));
      if (nums.length) pick = nums.slice(0, 1);
      else {
        const cand = idx.filter(i => !isStopWord(WORDS[i].w) && norm(WORDS[i].w).replace(/'/g, '').length >= 4);
        cand.sort((a, b) => (norm(WORDS[b].w).length + (b - p[0]) * 0.8) - (norm(WORDS[a].w).length + (a - p[0]) * 0.8));
        if (cand.length && idx.length >= 2) pick = cand.slice(0, 1);
      }
    }
    p[2] = pick;
  }
  return out;
}

let HL = null;
function layoutPhrases() {
  HL = PHRASE_LIST.map((p, n) => {
    const o = p.o || {};
    const size = o.size || CAP.size, maxW = o.maxW || CAP.maxW;
    const words = [];
    for (let i = p.i0; i <= p.i1; i++) {
      const w = WORDS[i]; if (!w) continue;
      const em = p.em.includes(i);
      const disp = (o.swap && o.swap[i] !== undefined) ? o.swap[i] : w.w.replace(/["“”]/g, '');
      if (!disp) continue;
      const f = em ? { font: F.serif, italic: true, weight: 400, size: Math.round(size * 1.16) } : { font: F.grot, weight: 500, size, ls: -size * 0.03 };
      words.push({ ...w, disp, em, f, wd: measure(K, disp, f) });
    }
    const sp = size * 0.26, lh = size * 1.08;
    let x = 0, line = 0;
    for (const w of words) { if (x > 0 && x + w.wd > maxW) { x = 0; line++; } w.x = x; w.line = line; x += w.wd + sp; }
    // right-to-left scripts (Arabic, Hebrew, Persian, Urdu): same line breaks, words placed from the right edge leftwards
    if (words.some(w => /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.test(w.disp))) for (const w of words) w.x = maxW - w.x - w.wd;
    return { words, lines: line + 1, lh, size, s: p.s, end: p.end, o };
  });
}
function headline(ctx, t, sc) {
  if (REEL.captions === false || !PHRASE_LIST.length) return;
  if (!HL) layoutPhrases();
  if (sc.noHeadline && sc.noHeadline(t)) return;
  let ph = null;                                  // newest phrase that has started wins
  for (const p of HL) if (t >= p.s - CAP.lead && t < p.end + 0.2 && sceneAt(p.s + 0.12) === sc) ph = p;
  if (!ph || ph.s < sc.start - 0.12) return;      // never let a phrase from the previous scene bleed across a cut
  const ex = clamp((t - ph.end) / 0.2);
  const base = sc.hl ? sc.hl(t) || {} : {};
  const x0 = base.x ?? CAP.x, y0 = base.y ?? CAP.y;
  const col = base.color || CAP.color || C.ink, emc = base.em || CAP.emphasis || C.red;
  ctx.save(); ctx.globalAlpha = (base.alpha ?? 1) * (1 - E.inCubic(ex));
  for (const w of ph.words) {
    const dt = t - w.s + CAP.lead;                // lead the voice slightly so the word is readable as it's spoken
    if (dt < 0) continue;
    const a = clamp(dt / 0.06), rise = (1 - E.outCubic(clamp(dt / 0.16))) * 14;
    const s = w.em ? 1 + ring(dt - 0.05, 2.4, 6) * 0.08 : 1;
    ctx.save(); ctx.globalAlpha *= a;
    ctx.translate(x0 + w.x, y0 + w.line * ph.lh + rise - ex * 40); ctx.scale(s, s);
    text(ctx, w.disp, 0, 0, Object.assign({}, w.f, { align: 'left', color: w.em ? emc : col }));
    ctx.restore();
  }
  ctx.restore();
}
// the phrase on screen at t: { n, i0, i1, s, end, em }
function phraseAt(t) { let r = null; for (const p of PHRASE_LIST) if (t >= p.s - 0.15) r = p; return r && t < r.end + 0.2 ? r : r; }
// bottom of the caption block (canvas y) for the phrase at t - place hero objects below this
function captionBottom(t) { if (!HL) layoutPhrases(); let ph = null; for (const p of HL) if (t >= p.s - 0.15) ph = p; return ph ? CAP.y + (ph.lines - 1) * ph.lh + ph.size * 0.3 : CAP.y; }
