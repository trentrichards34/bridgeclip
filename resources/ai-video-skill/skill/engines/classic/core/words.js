// ───────────────────────── words: the voice clock every scene cues on ─────────────────────────
// WORDS = build/words.json → [{ w, s, e }] (seconds on the final audio clock). Loaded by the boot before timeline.js and the scenes,
// so scene files can compute their beat times at load:   const T_SLAM = wordAt('camera', 0, 1, 0.2 * VO_END);
// Never hard-code seconds: every beat is a word (or a fraction of the voice as a fallback when a word is not in the script).
let WORDS = [], VO_END = 0, SENTENCES = [];
const norm = s => String(s).toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9$€£%'À-￿-]/g, '');

// start time of word index i (clamped, so a template never crashes on a short script)
const wi = i => WORDS.length ? WORDS[Math.max(0, Math.min(WORDS.length - 1, i))].s : 0;
const wiE = i => WORDS.length ? WORDS[Math.max(0, Math.min(WORDS.length - 1, i))].e : 0;
// index of the nth (1-based) word that starts with `word` (prefix match, case/punctuation-insensitive) at or after fromT, or -1
function wordIndex(word, fromT = 0, nth = 1) {
  const q = norm(word); let n = 0;
  if (!q) return -1;
  for (let i = 0; i < WORDS.length; i++) if (WORDS[i].s >= fromT - 1e-6 && norm(WORDS[i].w).startsWith(q) && ++n === nth) return i;
  return -1;
}
// start time of that word; `fallback` (seconds) when the word is not in the script (default: fromT)
function wordAt(word, fromT = 0, nth = 1, fallback) {
  const i = wordIndex(word, fromT, nth);
  return i >= 0 ? WORDS[i].s : (fallback ?? fromT);
}
// end time of that word
function wordEnd(word, fromT = 0, nth = 1, fallback) {
  const i = wordIndex(word, fromT, nth);
  return i >= 0 ? WORDS[i].e : (fallback ?? fromT);
}
// first of several candidate words (e.g. cueAny(['comment', 'follow', 'link'], 0, 0.85 * VO_END))
function cueAny(words, fromT = 0, fallback) {
  let best = Infinity;
  for (const w of words) { const i = wordIndex(w, fromT); if (i >= 0) best = Math.min(best, WORDS[i].s); }
  return best < Infinity ? best : (fallback ?? fromT);
}
// legacy names used by the library scenes: wt('word', nth, after) / we(...)
const wt = (w, k = 1, after = 0) => wordAt(w, after, k);
const we = (w, k = 1, after = 0) => wordEnd(w, after, k);
// voice fraction → seconds (0.5 = middle of the voice-over)
const frac = f => f * VO_END;
// the index of the word being spoken (or the last one started) at time t
function wordIdxAt(t) { let i = -1; for (let k = 0; k < WORDS.length; k++) { if (WORDS[k].s <= t) i = k; else break; } return i; }

// sentences: [{ i0, i1, s, e, text }] split on . ? ! (and on long pauses)
function buildSentences() {
  SENTENCES = [];
  let i0 = 0;
  for (let i = 0; i < WORDS.length; i++) {
    const end = /[.?!]["”)]*$/.test(WORDS[i].w) || i === WORDS.length - 1 || (WORDS[i + 1].s - WORDS[i].e > 0.6);
    if (end) { SENTENCES.push({ i0, i1: i, s: WORDS[i0].s, e: WORDS[i].e, text: WORDS.slice(i0, i + 1).map(w => w.w).join(' ') }); i0 = i + 1; }
  }
}
// start time of the first sentence that begins at or after time t (fallback: t) - robust scene cuts for ANY script
function sentenceAfter(t) { for (const s of SENTENCES) if (s.s >= t - 1e-6) return s.s; return t; }
// the sentence containing time t
function sentenceAt(t) { let r = SENTENCES[0]; for (const s of SENTENCES) if (s.s <= t) r = s; return r; }
const lastSentence = () => SENTENCES[SENTENCES.length - 1];

// fake word timings from script.txt (2.6 words/s) so a template previews before any voice exists
function fakeWords(script) {
  const out = []; let t = 0.1;
  for (const w of script.split(/\s+/).filter(Boolean)) {
    const d = 0.16 + Math.min(0.5, w.replace(/[^a-z0-9]/gi, '').length * 0.045);
    out.push({ w, s: +t.toFixed(3), e: +(t + d).toFixed(3) });
    t += d + (/[.?!]$/.test(w) ? 0.42 : /[,;:]$/.test(w) ? 0.2 : 0.06);
  }
  return out;
}

// ── language: reel.json "language" (ISO code: en ru uk es pt de fr it tr ar hi ...) picks the stop words (auto-emphasis, key words)
// and the words that mean "comment" (CTA detection). Unknown language → no stop words (length heuristic only) + English "comment".
const LEX = {
  en: { comment: ['comment'], stop: 'a an the and or but so to of in on at for with from by as is are was were be been it its this that these those you your yours i me my we our us they them their he she his her not no do does did have has had will would can could just very really than then there here what when where who how why if about into out up down over all any some more most also only even still get got make made like ever never every own' },
  ru: { comment: ['коммент', 'напиши', 'пиши', 'оставь'], stop: 'и а но или да не ни в во на с со к ко у о об от до по за из для без под над при про через это этот эта эти то тот та те так как что чтобы кто где когда если уже еще ещё же ли бы вот там тут здесь все всё всех я ты он она оно мы вы они мне меня тебе тебя его ее её нас вас их им свой свою своё твой твоя мой моя был была было были быть есть будет просто очень только даже тоже потом сейчас можно нужно надо' },
  uk: { comment: ['комент', 'напиши', 'пиши', 'залиш'], stop: 'і й та а але або не ні в у на з із зі до по за від для без під над при про через це цей ця ці той та ті так як що щоб хто де коли якщо вже ще же чи би ось там тут все всі я ти він вона воно ми ви вони мені мене тобі тебе його її нас вас їх свій твій мій був була було були бути є буде просто дуже тільки навіть теж потім зараз можна треба' },
  es: { comment: ['comenta', 'escribe'], stop: 'el la los las un una unos unas y o pero que de del a al en con por para sin sobre es son fue ser está están esto este esta estos eso ese esa lo le les se me te nos mi mis tu tus su sus yo tú él ella nosotros ellos no sí muy más menos ya hay como cuando donde porque si también solo todo todos' },
  pt: { comment: ['comenta', 'escreve', 'escreva'], stop: 'o a os as um uma uns umas e ou mas que de do da dos das em no na nos nas com por para sem sobre é são foi ser está estão isso isto esse essa este esta lo se me te nos meu minha seu sua eu você ele ela nós eles não sim muito mais menos já há como quando onde porque se também só todo todos tem' },
  de: { comment: ['kommentier', 'schreib'], stop: 'der die das den dem des ein eine einen einem einer und oder aber dass zu von mit für auf in im an am aus bei nach über um ist sind war waren sein bin bist hat haben wird werden es er sie wir ihr ich du man nicht kein keine ja nein sehr mehr nur auch noch schon so wie wenn wo was dann denn mal dein deine mein meine sich' },
  fr: { comment: ['commente', 'écris', 'ecris'], stop: 'le la les un une des et ou mais que qui de du à au aux en dans sur pour par avec sans est sont était être a ont avoir ce cet cette ces se ne pas plus je tu il elle on nous vous ils elles me te mon ma mes ton ta tes son sa ses très tout tous comme quand si aussi déjà encore y' },
  it: { comment: ['commenta', 'scrivi'], stop: 'il lo la i gli le un uno una e o ma che di del della da dal in nel nella con per su tra fra è sono era essere ha hanno questo questa quello quella si mi ti ci vi io tu lui lei noi voi loro non sì molto più meno già come quando dove perché se anche solo tutto tutti mio tuo suo' },
  tr: { comment: ['yorum'], stop: 've veya ama ile bir bu şu o da de ki mi mı mu mü için gibi kadar çok daha en ne neden nasıl her şey ben sen biz siz onlar var yok değil ise sonra önce artık hem ya sadece bile' },
  ar: { comment: ['علق', 'علّق', 'اكتب', 'تعليق'], stop: 'و في من إلى على عن مع هذا هذه ذلك تلك هو هي هم أنا أنت نحن أن إن كان كانت لا ما لم لن قد ثم أو كل بعض هناك هنا الذي التي الذين كما لكن بل حتى إذا عند' },
  hi: { comment: ['कमेंट', 'कॉमेंट', 'लिखो', 'लिखें', 'टिप्पणी'], stop: 'और या लेकिन का के की को में से पर है हैं था थे थी हो होता होती यह वह ये वो मैं तुम आप हम वे इस उस एक भी तो ही नहीं न क्या कि जो जब तक अब बहुत सब कुछ अपना अपने' },
};
const reelLang = () => String((typeof REEL !== 'undefined' && REEL && REEL.language) || 'en').toLowerCase().split(/[-_]/)[0];
const _LEXC = {};
function stopWords(lang = reelLang()) { return _LEXC[lang] || (_LEXC[lang] = new Set(LEX[lang] ? LEX[lang].stop.split(' ').map(norm) : [])); }
const isStopWord = (w, lang) => stopWords(lang).has(norm(w));
// words that mean "comment" in the reel's language (prefix match), plus English "comment" (except in French, where it means "how")
function commentWords(lang = reelLang()) { const own = (LEX[lang] && LEX[lang].comment) || []; return lang === 'fr' ? own : own.concat(lang === 'en' ? [] : ['comment']); }
const isCommentWord = w => { const n = norm(w); return !!n && commentWords().some(c => n.startsWith(norm(c))); };
// index of the first "comment" word (any of commentWords) at or after fromT, or -1
function commentIndex(fromT = 0) { for (let i = 0; i < WORDS.length; i++) if (WORDS[i].s >= fromT - 1e-6 && isCommentWord(WORDS[i].w)) return i; return -1; }

// the "strongest" word index in [i0, i1]: a number if there is one (unless o.numbers === false), else the longest content word (later words win ties)
function keyWordIdx(i0, i1, o = {}) {
  let best = -1, score = -1;
  for (let i = Math.max(0, i0); i <= Math.min(WORDS.length - 1, i1); i++) {
    const w = norm(WORDS[i].w).replace(/'/g, '');
    const sc = /\d/.test(w) ? (o.numbers === false ? -1 : 100 + i) : isStopWord(WORDS[i].w) ? -1 : w.length + (i - i0) * 0.8;
    if (sc > score) { score = sc; best = i; }
  }
  return best < 0 ? i0 : best;
}
// clauses (split on , ; : . ? !) inside [t0, t1): [{ i0, i1, s, e, key }] - handy for one beat per clause
function clauses(t0, t1) {
  const out = []; let i0 = -1;
  for (let i = 0; i < WORDS.length; i++) {
    if (WORDS[i].s < t0 - 1e-6 || WORDS[i].s >= t1) continue;
    if (i0 < 0) i0 = i;
    if (/[,;:.?!]["”)]*$/.test(WORDS[i].w) || i === WORDS.length - 1 || WORDS[i + 1].s >= t1) { out.push({ i0, i1: i, s: WORDS[i0].s, e: WORDS[i].e, key: keyWordIdx(i0, i, { numbers: false }) }); i0 = -1; }
  }
  return out;
}
const cleanWord = i => (WORDS[i] ? WORDS[i].w : '').replace(/^["“(]+|[.,;:?!"”)]+$/g, '');
