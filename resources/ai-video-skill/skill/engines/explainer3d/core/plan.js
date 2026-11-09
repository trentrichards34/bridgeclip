// Word helpers + the beat plan loader. The project's plan.js (default export) turns words into beats:
//
//   export default function plan(R) {          // R = { words, sentences, end, wordAt, find, wi, reel }
//     return [ { id: 'hook', t0: 0, look: 'studio' }, { id: 'explain', at: 'grid', blend: 0.8 }, ... ];
//   }                                           // or return { beats: [...], duration, keys: [...] }
//
// Beat fields: id (scenes/<id>.js), t0 (seconds) OR at ('word' | 'two words' | word index), look ('studio'|'city'),
// blend (seconds of transition INTO this beat, default 0.8; 0 = hard cut), transition ('whip'|'swoop'|'cut'),
// plus anything else you want to read in the scene (spec.foo).

export const bare = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

export function makeWordTools(words) {
  const W = words.map((w, i) => ({ ...w, i, b: bare(w.w) }));
  // n-th occurrence (from time `from`) of a word or a phrase ('right now'). Exact match first, then prefix match.
  function find(phrase, from = 0, nth = 0) {
    const parts = String(phrase).split(/\s+/).map(bare).filter(Boolean);
    if (!parts.length) return null;
    for (const loose of [false, true]) {
      let n = 0;
      for (let i = 0; i + parts.length <= W.length; i++) {
        if (W[i].s < from - 0.05) continue;
        let ok = true;
        for (let j = 0; j < parts.length && ok; j++) {
          const w = W[i + j].b, p = parts[j];
          ok = loose ? (w.startsWith(p) && p.length >= 3) : w === p;
        }
        if (ok) { if (n === nth) return W[i]; n++; }
      }
    }
    return null;
  }
  const wordAt = (phrase, from = 0, nth = 0) => { const w = find(phrase, from, nth); return w ? w.s : null; };
  const wi = (i) => { if (!W.length) return null; const k = i < 0 ? W.length + i : i; return W[Math.max(0, Math.min(W.length - 1, k))].s; };
  const sentences = [];
  let cur = [];
  for (const w of W) { cur.push(w); if (/[.!?]["”']?$/.test(w.w)) { sentences.push(cur); cur = []; } }
  if (cur.length) sentences.push(cur);
  const sents = sentences.map((ws) => ({ t0: ws[0].s, t1: ws[ws.length - 1].e, i0: ws[0].i, i1: ws[ws.length - 1].i, text: ws.map((w) => w.w).join(' '), words: ws }));
  const end = W.length ? W[W.length - 1].e : 0;
  return { words: W, find, wordAt, wi, sentences: sents, end };
}

export async function loadPlan(words, reel, base, planFn = null) {
  const T = makeWordTools(words);
  let mod = planFn ? { default: planFn } : null;
  if (!mod) {
    try { mod = await import(new URL('plan.js', base).href); }
    catch (e) { console.error('plan.js missing or broken, using a single beat:', e.message); }
  }
  let out = mod && typeof mod.default === 'function' ? mod.default({ ...T, reel }) : null;
  if (Array.isArray(out)) out = { beats: out };
  if (!out || !out.beats || !out.beats.length) out = { beats: [{ id: 'hook', t0: 0 }] };
  const look0 = reel.look || 'studio';
  // `at` phrases are searched FROM the previous beat's time, so a phrase that also appears earlier ("a second" in "times a second")
  // can't pull a beat back in time. Beats that still land out of order are reported loudly.
  let prevT = 0;
  const resolveT = (b) => {
    if (typeof b.t0 === 'number') return b.t0;
    if (typeof b.at === 'number') return T.wi(b.at) ?? null;
    if (typeof b.at === 'string') {
      const t = T.wordAt(b.at, prevT + 0.01) ?? T.wordAt(b.at);
      if (t != null) return t;
      console.warn(`plan: word "${b.at}" not found for beat ${b.id}`);
    }
    return null;
  };
  let beats = out.beats.map((b) => { const t0 = resolveT(b); if (t0 != null) prevT = t0; return { ...b, t0, look: b.look || look0 }; });
  beats.forEach((b, i) => { if (i && b.t0 != null && beats[i - 1].t0 != null && b.t0 <= beats[i - 1].t0)
    console.error(`plan: beat "${b.id}" (t0 ${b.t0.toFixed(2)}) starts before/at beat "${beats[i - 1].id}" (${beats[i - 1].t0.toFixed(2)}): fix its 'at' (use a word index or a longer phrase)`); });
  // beats whose cue was not found are spaced evenly between their neighbours
  beats.forEach((b, i) => {
    if (b.t0 != null) return;
    let j = i; while (j < beats.length && beats[j].t0 == null) j++;
    const a = i > 0 ? beats[i - 1].t0 : 0, z = j < beats.length ? beats[j].t0 : Math.max(T.end, a + 2);
    b.t0 = a + (z - a) * (1 / (j - i + 1));
  });
  beats[0].t0 = 0;
  const duration = out.duration ?? Math.max(T.end + (reel.tail ?? 1.0), reel.duration || 0, 2);
  beats = beats.map((b, i) => {
    const t1 = i < beats.length - 1 ? beats[i + 1].t0 : duration;
    const blend = i === 0 ? 0 : (b.blend ?? 0.8);
    return { ...b, n: i, t1, blend: b.transition === 'cut' ? 0 : blend };
  });
  return { beats, duration, keys: out.keys || [], T };
}
