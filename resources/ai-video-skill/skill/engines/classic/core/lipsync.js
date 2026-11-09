// ───────────────────────── lip sync: words.json → per-frame mouth shapes (no external tools) ─────────────────────────
// Letters → rough phonemes (digraph rules), each word's phonemes spread over its [s, e] (vowels get more time), keyframes
// interpolated, coarticulation-smoothed (fast attack, slower release), bilabial closures (m b p) punched through.
// Any language: Cyrillic (ru uk be kk sr mk bg ...) and Greek are transliterated to phonetic Latin first, accented Latin letters
// lose their accents (é ñ ü ç ş ß ...); words in any other script (Arabic, Hebrew, Devanagari, CJK, Thai ...) get a syllable-rate
// open/close mouth driven by the word's duration (~5 syllables/s), so the mouth always articulates instead of holding one shape.
// Output: VIS = { fps, jaw[], lipW[], press[], teeth[], tongue[] } and ENV[] (a 0..1 talk envelope for head bob / brows).
let VIS = null, ENV = [];
const VIS_FPS = 60;
(() => {
  //            jaw   lipW  press teeth tongue
  const SHAPE = {
    P: [0, 0, 1, 0, 0], M: [0, 0, 1, 0, 0], F: [0.12, 0.2, 0, 1, 0], TH: [0.25, 0.2, 0, 0.5, 0.9], L: [0.35, 0.2, 0, 0.3, 1],
    W: [0.15, -1, 0, 0, 0], UW: [0.25, -0.9, 0, 0, 0], OW: [0.5, -0.75, 0, 0, 0], AO: [0.65, -0.4, 0, 0, 0],
    AA: [0.9, 0.1, 0, 0.2, 0], AE: [0.8, 0.5, 0, 0.4, 0], AH: [0.55, 0.15, 0, 0.2, 0], AY: [0.8, 0.3, 0, 0.3, 0],
    EH: [0.45, 0.65, 0, 0.6, 0], IH: [0.28, 0.75, 0, 0.6, 0], IY: [0.2, 0.95, 0, 0.7, 0], ER: [0.3, -0.4, 0, 0.2, 0], R: [0.25, -0.5, 0, 0.2, 0],
    S: [0.12, 0.5, 0, 0.9, 0], T: [0.18, 0.3, 0, 0.7, 0.5], N: [0.18, 0.3, 0, 0.5, 0.5], SH: [0.18, -0.55, 0, 0.5, 0],
    K: [0.3, 0.2, 0, 0.3, 0], HH: [0.35, 0.2, 0, 0.2, 0], Y: [0.2, 0.7, 0, 0.5, 0],
  };
  const REST = [0, 0, 0.15, 0, 0];
  const VOW = new Set(['UW', 'OW', 'AO', 'AA', 'AE', 'AH', 'AY', 'EH', 'IH', 'IY', 'ER']);
  const DIG = [['tion', ['SH', 'AH', 'N']], ['ough', ['OW']], ['igh', ['AY']], ['th', ['TH']], ['sh', ['SH']], ['ch', ['SH']], ['ph', ['F']], ['wh', ['W']],
    ['ck', ['K']], ['ng', ['N']], ['qu', ['K', 'W']], ['oo', ['UW']], ['ee', ['IY']], ['ea', ['IY']], ['ai', ['EH']], ['ay', ['EH']], ['oa', ['OW']],
    ['ou', ['AW']], ['ow', ['OW']], ['oi', ['OW', 'IY']], ['oy', ['OW', 'IY']], ['au', ['AO']], ['aw', ['AO']], ['er', ['ER']], ['ir', ['ER']], ['ur', ['ER']], ['ar', ['AA', 'R']], ['or', ['AO', 'R']]];
  const ONE = { a: 'AE', e: 'EH', i: 'IH', o: 'AA', u: 'AH', y: 'IY', b: 'P', p: 'P', m: 'M', f: 'F', v: 'F', l: 'L', w: 'W', r: 'R', s: 'S', z: 'S', c: 'K', x: 'K',
    k: 'K', g: 'K', q: 'K', j: 'SH', t: 'T', d: 'T', n: 'N', h: 'HH' };
  const NUM = { 0: 'zero', 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine' };
  // phonetic Latin for Cyrillic (Russian, Ukrainian, Belarusian, Kazakh, Serbian/Macedonian, Bulgarian) and Greek (with tonos)
  const TRL = {
    а: 'a', б: 'b', в: 'v', г: 'g', ґ: 'g', д: 'd', е: 'e', ё: 'yo', є: 'ye', ж: 'zh', з: 'z', и: 'ee', і: 'ee', ї: 'yee', й: 'y', к: 'k', л: 'l', м: 'm',
    н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'oo', ў: 'w', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e',
    ю: 'yoo', я: 'ya', ә: 'a', ғ: 'g', қ: 'k', ң: 'ng', ө: 'o', ұ: 'oo', ү: 'oo', һ: 'h', ђ: 'j', ј: 'y', љ: 'l', њ: 'n', ћ: 'ch', џ: 'j', ѓ: 'g', ќ: 'k', ѕ: 'dz',
    α: 'a', ά: 'a', β: 'v', γ: 'g', δ: 'th', ε: 'e', έ: 'e', ζ: 'z', η: 'ee', ή: 'ee', θ: 'th', ι: 'ee', ί: 'ee', ϊ: 'ee', ΐ: 'ee', κ: 'k', λ: 'l', μ: 'm',
    ν: 'n', ξ: 'ks', ο: 'o', ό: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'ee', ύ: 'ee', ϋ: 'ee', ΰ: 'ee', φ: 'f', χ: 'h', ψ: 'ps', ω: 'o', ώ: 'o',
    ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', ł: 'l', đ: 'd', ı: 'i', þ: 'th', ð: 'th',
  };
  // → { lat: phonetic a-z text, foreign: true when the word has letters of a script we can't transliterate }
  function translit(word) {
    let w = String(word).toLowerCase(), nonLatin = /[^\u0000-\u024F]/.test(w);
    w = w.replace(/ο[υύ]/g, 'oo').replace(/[εέοό][ιί]/g, 'ee').replace(/[αά][ιί]/g, 'e').replace(/([αάεέ])[υύ]/g, '$1v');   // Greek digraphs
    w = w.replace(/[\u0370-\u03FF\u0400-\u04FF\u0500-\u052Fßæœøłđıþð]/g, c => TRL[c] ?? c);
    w = w.normalize('NFD').replace(/[\u0300-\u036f]/g, '');                   // é → e, ñ → n, ü → u, ç → c, ş → s ...
    const lat = w.replace(/\d/g, d => NUM[d] + ' ').replace(/[^a-z ]/g, '');
    return { lat, nonLatin, foreign: !/[a-z]/.test(lat.replace(/\s/g, '')) && /\p{L}/u.test(w) };
  }
  // syllable-rate open/close for words in scripts we can't read (≈ 5 syllables/s from the word's duration, deterministic)
  const SYL_C = ['N', 'T', 'K', 'M', 'S', 'L', 'T', 'HH'], SYL_V = ['AA', 'EH', 'AO', 'IY', 'AH', 'UW', 'AE', 'IH'];
  function syllables(word, dur) {
    const n = Math.max(1, Math.min(14, Math.round(dur * 5))), h = [...String(word)].reduce((a, c) => (a * 31 + c.codePointAt(0)) >>> 0, 7), out = [];
    for (let i = 0; i < n; i++) { if (i || (h & 1)) out.push(SYL_C[(h + i * 3) % SYL_C.length]); out.push(SYL_V[(h >> 3) + i * 5 & 7]); }
    return out;
  }
  function phones(word, dur = 0.3) {
    const tr = translit(word);
    if (tr.foreign) return syllables(word, dur);
    const w = tr.lat;
    const out = [];
    for (let part of w.split(' ')) {
      if (!part) continue;
      if (!tr.nonLatin && part.length > 3 && part.endsWith('e') && !/[aeiouy]e$/.test(part)) part = part.slice(0, -1);   // silent final e (English)
      let i = 0;
      while (i < part.length) {
        let hit = null;
        for (const [g, ph] of DIG) if (part.startsWith(g, i)) { hit = [g, ph]; break; }
        if (hit) { out.push(...hit[1]); i += hit[0].length; continue; }
        const ph = ONE[part[i]]; if (ph && ph !== out[out.length - 1]) out.push(ph); i++;
      }
    }
    return out.length ? out.map(p => p === 'AW' ? 'AO' : p) : ['AH'];
  }
  window.buildLipSync = function (words, dur) {
    const N = Math.max(2, Math.ceil((dur + 1) * VIS_FPS)), keys = [];
    for (const w of words) {
      const ph = phones(w.w, w.e - w.s), wts = ph.map(p => VOW.has(p) ? 1.7 : (p === 'T' || p === 'K' || p === 'P') ? 0.7 : 1);
      const tot = wts.reduce((a, b) => a + b, 0), d = Math.max(0.06, w.e - w.s);
      let acc = 0;
      ph.forEach((p, i) => { const c = w.s + (acc + wts[i] / 2) / tot * d; acc += wts[i]; keys.push([c, SHAPE[p] || SHAPE.AH, p === 'P' || p === 'M']); });
    }
    for (let i = 0; i + 1 < words.length; i++) if (words[i + 1].s - words[i].e > 0.18) keys.push([(words[i].e + words[i + 1].s) / 2, REST, false]);
    if (words.length) { keys.push([words[0].s - 0.2, REST, false]); keys.push([words[words.length - 1].e + 0.25, REST, false]); }
    keys.sort((a, b) => a[0] - b[0]);
    const raw = [0, 1, 2, 3, 4].map(() => new Float32Array(N));
    let k = 0;
    for (let f = 0; f < N; f++) {
      const t = f / VIS_FPS;
      while (k + 1 < keys.length && keys[k + 1][0] <= t) k++;
      const A = keys[k], B = keys[k + 1];
      for (let j = 0; j < 5; j++) {
        if (!A) raw[j][f] = REST[j];
        else if (!B || t <= A[0]) raw[j][f] = t < A[0] ? REST[j] + (A[1][j] - REST[j]) * clamp(1 - (A[0] - t) / 0.2) : A[1][j];
        else raw[j][f] = lerp(A[1][j], B[1][j], (t - A[0]) / Math.max(1e-6, B[0] - A[0]));
      }
    }
    const out = [0, 1, 2, 3, 4].map(() => new Float32Array(N)), v = [0, 0, 0.15, 0, 0];
    for (let f = 0; f < N; f++) for (let j = 0; j < 5; j++) { v[j] += (raw[j][f] - v[j]) * (raw[j][f] > v[j] ? 0.62 : 0.42); out[j][f] = v[j]; }
    for (const [c, , bil] of keys) if (bil) for (let f = Math.floor((c - 0.03) * VIS_FPS); f < (c + 0.03) * VIS_FPS; f++) if (f >= 0 && f < N) { out[0][f] = Math.min(out[0][f], 0.03); out[2][f] = 1; }
    // per-word stress: content words (long) open wider than "a", "the"
    for (const w of words) { const tr = translit(w.w), len = tr.foreign ? (w.e - w.s) * 14 : tr.lat.replace(/\s/g, '').length, g = 0.72 + 0.28 * clamp((len - 2) / 6); for (let f = Math.floor(w.s * VIS_FPS); f < w.e * VIS_FPS && f < N; f++) if (f >= 0) out[0][f] *= g; }
    VIS = { fps: VIS_FPS, jaw: out[0], lipW: out[1], press: out[2], teeth: out[3], tongue: out[4] };
    ENV = new Float32Array(N); let e = 0;
    for (let f = 0; f < N; f++) { e += (out[0][f] * 1.4 - e) * 0.12; ENV[f] = clamp(e); }
  };
  window.lipPhones = phones;
})();
function visAt(t) {
  if (!VIS) return { jaw: 0, lipW: 0, press: 0.15, teeth: 0, tongue: 0, mouth: 0 };
  const f = t * VIS.fps, i = Math.max(0, Math.min(VIS.jaw.length - 2, Math.floor(f))), u = clamp(f - i);
  const g = k => lerp(VIS[k][i], VIS[k][i + 1], u);
  const jaw = g('jaw');
  return { jaw, lipW: g('lipW'), press: g('press'), teeth: g('teeth'), tongue: g('tongue'), mouth: jaw * 0.95 };
}
const envAt = t => ENV.length ? ENV[Math.max(0, Math.min(ENV.length - 1, Math.floor(t * VIS_FPS)))] : 0;
