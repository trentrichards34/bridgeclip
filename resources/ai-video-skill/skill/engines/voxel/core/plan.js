// plan.js (core): turns the project's beat list (project plan.js) + build/words.json into timed beats.
// A beat = one scene at its own STATION (spec.o = [index * gap, 0, 0]); the core whip-pans between stations.
//
// Project plan.js exports:
//   export const BEATS = [ { id, at, head, scene?, blend?, whipLead?, tone?, t0?, t1? }, ... ];
//   export const OPTIONS = { tail: 0.6, blend: 0.45, gap: 300, whipLead };  (all optional)
//     id     unique beat id (also the scene file scenes/<id>.js unless `scene` names another file to reuse)
//     at     where the beat starts. One of:
//              'word'               first occurrence of that word after the previous beat's start ('comment', 'camera.')
//              { word, nth }        nth occurrence (0-based) after the previous beat's start
//              17                   word index (negative = from the end: -1 = last word)
//              { sentence: 2 }      first word of the 3rd sentence (negative = from the end)
//              { frac: 0.5 }        the word nearest 50 % of the voiceover
//            Common words ('the', 'and', 'you'...) warn: prefer a word index from build/word_index.txt or a unique word.
//            add `or: <another at>` as a fallback (e.g. { word: 'comment', or: { sentence: -1 } }). The first beat always starts at 0.
//     head   headline strip text: 'TEXT' | 'auto' (2-3 key words of the beat) | 'cta' ('COMMENT <KEYWORD>') | null (none).
//            '{KEYWORD}' inside a string is replaced by reel.json cta.keyword. Consecutive beats with the same head keep one strip.
//     t0/t1  explicit seconds (override `at` / the next beat) - avoid, cue on words instead.
//     blend  length of the whip-pan INTO this beat (default OPTIONS.blend 0.45 s).
//     whipLead  seconds before THIS beat's t1 that the whip OUT starts (0..next blend; default blend/2 = ~0.22 s, so events on
//            the beat's last word land in the blur). Lower it (0.05-0.1) when the payoff sits on the last word.
//     tone   'bright' | 'normal' | 'dim' | { exposure, bloomK }: default exposure/bloom for this beat (main.js TONES).
// Result spec: { id, scene, n, t0, t1, blend, head, o: [x,0,0], i0, i1 (word index range), words: [...], line }
const STOP = new Set(('a an the and or but so if then than to of in on at by for with from into onto as is are was were be been being am do does did ' +
  'it its it\'s this that these those there here i you he she we they me him her us them my your our their his what which who whom whose ' +
  'not no yes just very really can could would should will shall may might must have has had get got make made let lets let\'s ' +
  'about over under up down out off all any some each every more most much many such own same other only also even ever before after ' +
  'when where why how while because until again once doesn\'t don\'t isn\'t aren\'t won\'t can\'t i\'ll you\'ll i\'m you\'re it\'ll ' +
  'see say said saw look thing things way lot gonna kind one two').split(/\s+/));

// cue words that are too common to be safe beat cues (plan warns, suggests a word index instead)
const CUE_STOP = new Set('the a an and or to of in on it is you your i that this so but'.split(' '));

export const bare = (s) => String(s).toLowerCase().replace(/[’]/g, "'").replace(/[^a-z0-9'À-￿]/g, '');
export const clean = (s) => String(s).replace(/^[^\p{L}\p{N}$#@]+|[^\p{L}\p{N}%]+$/gu, '');

// sentences: [{ i0, i1 }] (inclusive word indices); a word ending in . ! ? ends a sentence
export function sentences(words) {
  const out = []; let i0 = 0;
  words.forEach((w, i) => { if (/[.!?]["')\]]?$/.test(w.w) || i === words.length - 1) { out.push({ i0, i1: i }); i0 = i + 1; } });
  return out;
}

// key words of a range, in order: long, non-stopword, de-duplicated. n = how many.
export function keyWords(words, i0 = 0, i1 = words.length - 1, n = 3) {
  const cand = [];
  for (let i = i0; i <= i1 && i < words.length; i++) {
    const b = bare(words[i].w); if (!b || STOP.has(b) || b.length < 3) continue;
    if (cand.some((c) => bare(c.w) === b)) continue;
    cand.push({ ...words[i], i, score: b.length + (/^[A-Z]/.test(words[i].w) && i > i0 ? 2 : 0) + (/[!?]$/.test(words[i].w) ? 1 : 0) });
  }
  const top = [...cand].sort((a, b) => b.score - a.score || a.i - b.i).slice(0, n);
  return top.sort((a, b) => a.i - b.i).map((c) => ({ w: clean(c.w), s: c.s, e: c.e, i: c.i }));
}

function resolveAt(at, words, sents, prevI, dur) {
  if (at == null) return null;
  if (typeof at === 'number') { const i = at < 0 ? words.length + at : at; return i >= 0 && i < words.length ? i : null; }
  if (typeof at === 'string') at = { word: at };
  let r = null;
  if (at.word != null) {
    const b = bare(at.word); let n = 0;
    for (let i = Math.max(0, prevI + 1); i < words.length; i++) if (bare(words[i].w) === b) { if (n === (at.nth ?? 0)) { r = i; break; } n++; }
  } else if (at.sentence != null) {
    const s = sents[at.sentence < 0 ? sents.length + at.sentence : at.sentence]; r = s ? s.i0 : null;
  } else if (at.frac != null) {
    const T = at.frac * dur; let best = null;
    words.forEach((w, i) => { if (best === null || Math.abs(w.s - T) < Math.abs(words[best].s - T)) best = i; }); r = best;
  }
  if ((r === null || r <= prevI) && at.or) return resolveAt(at.or, words, sents, prevI, dur);
  return r;
}

export function buildPlan(words, BEATS, OPTIONS = {}, reel = {}) {
  const tail = OPTIONS.tail ?? 0.6, gap = OPTIONS.gap ?? 300, blend0 = OPTIONS.blend ?? 0.45;
  const voEnd = words.length ? words[words.length - 1].e : 6;
  const sents = sentences(words);
  const kw = String(reel?.cta?.keyword ?? 'REEL').toUpperCase();
  // 1. start word index per beat (monotonic; unresolved beats are spread evenly between their neighbours)
  //    word cues are searched FROM the previous beat's start word (never from 0), so a repeated word lands after the previous beat.
  const idx = []; let prev = -1;
  const atWords = (a) => a == null ? [] : typeof a === 'string' ? [a] : typeof a === 'object' ? [...(a.word != null ? [a.word] : []), ...atWords(a.or)] : [];
  BEATS.forEach((b, n) => {
    if (n > 0) for (const w of atWords(b.at)) if (CUE_STOP.has(bare(w)))
      console.warn(`[plan] beat "${b.id}": at '${w}' is a common word and may match the wrong spot. Use a word index from build/word_index.txt (at: 17) or a unique word.`);
    let i = n === 0 ? 0 : resolveAt(b.at, words, sents, prev, voEnd);
    if (n > 0 && b.at != null && b.t0 == null && (i === null || i <= prev))
      console.error(`[plan] beat "${b.id}": at ${JSON.stringify(b.at)} ${i === null ? `not found after word ${prev}` : `resolves to word ${i} ("${words[i]?.w}"), at/before the previous beat (word ${prev})`}; spreading it evenly instead. Fix the cue (use a word index).`);
    if (i !== null && i <= prev) i = null;
    idx.push(i); if (i !== null) prev = i;
  });
  for (let n = 0; n < idx.length; n++) if (idx[n] === null) {
    let a = n - 1; while (a >= 0 && idx[a] === null) a--;
    let b = n + 1; while (b < idx.length && idx[b] === null) b++;
    const ia = a >= 0 ? idx[a] : 0, ib = b < idx.length ? idx[b] : words.length;
    idx[n] = Math.min(words.length - 1, Math.round(ia + (ib - ia) * (n - a) / (b - a)));
  }
  // 2. times
  const specs = BEATS.map((b, n) => {
    const i0 = idx[n], i1 = n + 1 < BEATS.length ? Math.max(i0, idx[n + 1] - 1) : words.length - 1;
    const t0 = b.t0 ?? (n === 0 ? 0 : (words[i0]?.s ?? 0) - 0.05);
    return { ...b, n, i0, i1, t0, scene: b.scene ?? b.id, blend: n === 0 ? 0 : (b.blend ?? blend0), whipLead: b.whipLead ?? OPTIONS.whipLead, o: [n * gap, 0, 0] };
  });
  let DURATION = Math.max(voEnd + tail, OPTIONS.minDuration ?? 0);
  specs.forEach((s, n) => { s.t1 = s.t1 ?? (n + 1 < specs.length ? specs[n + 1].t0 : DURATION); });
  DURATION = Math.max(DURATION, specs[specs.length - 1].t1);
  specs.forEach((s, n) => {   // sanity: out of order / overlapping / too short beats (bad cues or explicit t0/t1)
    const p = specs[n - 1];
    if (p && (s.t0 < p.t0 || s.i0 < p.i0)) console.error(`[plan] beat "${s.id}" starts before "${p.id}" (t0 ${s.t0.toFixed(2)} < ${p.t0.toFixed(2)}): beats out of order.`);
    else if (p && p.t1 > s.t0 + 0.01) console.error(`[plan] beat "${p.id}" (t1 ${p.t1.toFixed(2)}) overlaps "${s.id}" (t0 ${s.t0.toFixed(2)}).`);
    if (s.tone != null && typeof s.tone === 'string' && !['bright', 'normal', 'dim'].includes(s.tone)) console.error(`warning: [plan] beat "${s.id}": unknown tone '${s.tone}' (use 'bright', 'normal', 'dim' or { exposure, bloomK }); ignored.`);
    if (s.t1 - s.t0 < 0.8) console.error(`[plan] beat "${s.id}" is only ${(s.t1 - s.t0).toFixed(2)} s long (t0 ${s.t0.toFixed(2)}): its cue probably matched too early. Use a word index.`);
  });
  // 3. words + headlines
  for (const s of specs) {
    s.words = words.slice(s.i0, s.i1 + 1).map((w, k) => ({ ...w, i: s.i0 + k }));
    s.line = s.words.map((w) => w.w).join(' ');
    let h = s.head;
    if (h === 'auto') {
      let k = keyWords(words, s.i0, s.i1, 3); if (k.filter((x) => x.w.length >= 4).length >= 2) k = k.filter((x) => x.w.length >= 4);
      h = k.map((x) => x.w.toUpperCase()).join(' '); while (h.length > 22 && h.includes(' ')) h = h.slice(0, h.lastIndexOf(' '));
    }
    else if (h === 'cta') h = `COMMENT ${kw}`;
    else if (typeof h === 'string') h = h.replace(/\{KEYWORD\}/g, kw);
    s.head = h || null;
  }
  return { specs, DURATION };
}
