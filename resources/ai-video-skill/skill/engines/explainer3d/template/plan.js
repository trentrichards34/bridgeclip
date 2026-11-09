// The beat plan: which scene plays when. Beats are cued on WORDS (build/words.json), never on hard-coded seconds.
// R = { words, sentences: [{t0, t1, text, words}], end, wordAt(phrase, from, nth), find(phrase), wi(index), reel }
// Beat: { id: 'scenes/<id>.js', t0: seconds | at: 'word' | 'two words' | wordIndex, look: 'studio'|'city',
//         blend: seconds of transition INTO the beat (default 0.8, 0 = hard cut), transition: 'whip'|'swoop'|'cut' }
// A new beat (new shot / new station) every ~2-4 s. Return an array, or { beats, duration, keys }.
export default function plan({ sentences, end }) {
  const s = sentences;
  const cta = s.length > 2 ? s[s.length - 1].t0 : end * 0.8;            // the last sentence is the CTA
  const explain = s.length > 2 ? s[1].t0 : end * 0.3;                    // the hook is the first sentence
  return [
    { id: 'hook', t0: 0 },
    { id: 'explain', t0: explain, blend: 0.8 },
    // { id: 'city_example', t0: <a word time>, look: 'city', blend: 0.9 },  // example of the golden-hour city look
    { id: 'cta', t0: cta, blend: 0.8 },
  ];
}
