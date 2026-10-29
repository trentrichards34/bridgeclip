// ───────────────────────── timeline: scene files, cut points, captions, sparse SFX ─────────────────────────
// Loaded AFTER build/words.json (WORDS, SENTENCES are ready) and BEFORE the scene files, so the cut times below are visible to
// every scene. Everything is cued on words: wordAt('comment'), sentenceAfter(t), wi(index). Never hard-code seconds.
// Look at build/word_index.txt for "index start end word" to pick your cue words.
// The starter scenes are a PATTERN SKELETON (guides/styles/classic.md §0): a stage that BUILDS UP on the stressed words, live
// elements that never freeze, a presenter who acts, wipes, the CTA. Their hook/middle props are plain placeholders: replace each
// "THIS REEL'S METAPHOR" block with objects invented for your script (guides/patterns.md); motion primitives: kits/mechanics.js.

SCENE_FILES = ['scenes/hook.js', 'scenes/middle.js', 'scenes/cta.js'];

const KEYWORD = String((REEL.cta && REEL.cta.keyword) || 'REEL').toUpperCase();
// cut 1: the first sentence that starts after ~18% of the voice (the hook is the first 1-2 sentences)
const CUT_MIDDLE = sentenceAfter(Math.max(1.6, frac(0.18))) - 0.1;
// cut 2: the sentence that says "Comment <KEYWORD>" in the reel's language (commentIndex knows the word per language; fallback: the last sentence)
const CUT_CTA = (() => {
  const i = Math.max(commentIndex(CUT_MIDDLE + 0.5), wordIndex(KEYWORD, CUT_MIDDLE + 0.5));
  const s = i >= 0 ? sentenceAt(WORDS[i].s) : lastSentence();
  return Math.max(CUT_MIDDLE + 1.5, s.s - 0.1);
})();

// Stressed words of ANY script: up to n word indices in [t0, t1) (strongest content words: numbers, then the longest non-stop words),
// at least `gap` s apart, in time order. Starter scenes cue their build-up events on these, with fractions of the beat as fallbacks.
function tplBeats(t0, t1, n, gap = 0.4) {
  const c = [];
  for (let i = 0; i < WORDS.length; i++) {
    const w = WORDS[i]; if (w.s < t0 || w.s >= t1 || isStopWord(w.w)) continue;
    const k = norm(w.w).replace(/'/g, ''); if (k.length < 3 && !/\d/.test(k)) continue;
    c.push({ i, t: w.s, sc: (/\d/.test(k) ? 100 : 0) + k.length + (/[,.;:?!]$/.test(w.w) ? 1.5 : 0) });
  }
  c.sort((a, b) => b.sc - a.sc || a.t - b.t);
  const out = [];
  for (const q of c) { if (out.length >= n) break; if (out.every(o => Math.abs(o.t - q.t) >= gap)) out.push(q); }
  return out.sort((a, b) => a.t - b.t);
}
// a UI word with a language-neutral fallback (reel.json "ui" can set any key: "ui": { "problem": "stress" })
const tplText = (key, fb) => { const v = uiText(key); return v === key ? fb : v; };
// a spoken word as an on-screen label (CAPS, no punctuation; '' if too long to read at size)
const tplWord = (i, max = 10) => { const s = cleanWord(i).toUpperCase(); return s.length <= max ? s : ''; };

TIMELINE = () => [
  ['hook', 0],
  ['middle', CUT_MIDDLE],
  ['cta', CUT_CTA],
];

// captions: null = automatic phrasing + emphasis (reel.json captions.emphasize lists words to set in serif italic accent).
// For full control, list phrases by word index: [[firstIdx, lastIdx, [emphasised idxs]], ...]
PHRASES = null;

// top-right readout (optional): t => ({ k: 'LABEL', v: 'value', hot: bool }) ; a scene can override with its own readout(t)
READOUT = null;

// SFX: sparse and quiet. A whoosh into every cut, a halftone dot wipe into the middle (radial) and into the CTA (diagonal).
for (const t of [CUT_MIDDLE, CUT_CTA]) cue(t - 0.12, 'whoosh', -4);
wipe(CUT_MIDDLE, 1);       // halftone dot wipe: ink dots cover the hook's stage, clear onto the middle's
wipe(CUT_CTA, 0);
