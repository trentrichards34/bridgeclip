/**
 * The call to action the speaker SAYS ("click the link below", "comment GUIDE", "follow for more"), found in timed
 * words without any AI call. The same rules as the engine's detector (engine/clip_engine/services/spoken_cta.py;
 * both are tested on engine/tests/fixtures/spoken_cta_cases.json), used here to start a Call to action graphic with the
 * words said at the playhead. Every word it returns is a word the speaker said, in the order said.
 */
import type { CtaKind, TimedWord } from './motion-graphics'

export interface SpokenCta {
  kind: CtaKind
  /** The words on the button, as said ("Hit the link"; "DM me GUIDE" with a DM keyword). */
  text: string
  /** Where the link is, as said ("below", "in my bio"), or ''. */
  where: string
  /** The comment or DM keyword said, upper case, or ''. */
  keyword: string
  /** A short line said right after it ("Get all the details"), or ''. */
  lead: string
  start_ms: number
  end_ms: number
}

const PRIORITY: Record<CtaKind, number> = { link: 5, comment: 4, dm: 4, follow: 2, save: 2, share: 1 }
const PAUSE_MS = 320
const MAX_FILLER = 3
const MAX_BUTTON_WORDS = 6
const MAX_LEAD_WORDS = 5
const set = (words: string): Set<string> => new Set(words.split(' '))
const LINK_VERBS = set('click tap hit press use check smash visit open follow')
const LINK_FILLER = set('the that this my our on out a first special free little')
const DESCRIBING = set("you i we they he she people someone it when if once you'll i'll we'll will can could would might gonna should who then after before until")
const OPENERS = set("just so and now then go simply please to guys ahead definitely make sure right okay ok all yeah also or first today let's")
const WHERE_PHRASES = ['down below', 'below', 'in my bio', 'in the bio', 'in bio', 'in my profile', 'on my profile', 'in the description', 'in the caption', 'in the comments',
  'in the pinned comment', 'down there', 'right here', 'on screen', 'where you see it'].map((p) => p.split(' '))
const WHERE_FILLER = set("is it's that's the link thats its at which in my right down up there")
const POINTS_DOWN = /\b(below|bio|profile|description|caption|comments?|down)\b/i
const LEAD_STARTS = set('get grab learn see download claim join watch start find book save access')
const STOP_AFTER = set("and so but because let let's if then or cause 'cause which that who")
const SIGNUP: [string[], string[]][] = [
  [['sign', 'up'], []], [['signup'], []], [['register'], ['now', 'today', 'here', 'below', 'for']], [['join'], ['now', 'today', 'us', 'free', 'for', 'the', 'my', 'our']],
  [['grab'], ['it', 'yours', 'your', 'a', 'this', 'the']], [['get'], ['access', 'yours', 'instant']], [['download'], ['it', 'the', 'my', 'this', 'yours']],
  [['claim'], ['your', 'yours', 'it', 'the']], [['apply'], ['now', 'today', 'here', 'below']], [['book'], ['a', 'your']]
]
const NOT_KEYWORD = set("the word words below down and a an with your you if what on this that it me for to in here now please just letter phrase emoji yes so i i'll we section box let about which right something anything one some more all too thoughts think")
const NOUN_BEFORE = set('a the that this your my his her their one every each no any first top')
const KEYWORD = /^[A-Za-z0-9][A-Za-z0-9-]{0,19}$/
const END = /[.!?…;:]["')\]]*$/
const COMMA = /,["')\]]*$/

const token = (raw: string): string => raw.toLowerCase().replace(/’/g, "'").replace(/[^\p{L}\p{N}_'$%-]+/gu, '').replace(/^['-]+|['-]+$/g, '')
const display = (raw: string): string => raw.trim().replace(/^[“"‘([]+|[”"’)\],.;:!?…]+$/g, '')
const capital = (text: string): string => text ? text.charAt(0).toUpperCase() + text.slice(1) : text

interface Candidate { kind: CtaKind; a: number; b: number; end: number; keyword?: string; buttonWhere?: boolean }

class Words {
  raw: string[] = []; tok: string[] = []; start: number[] = []; end: number[] = []
  constructor(words: readonly TimedWord[]) {
    for (const w of words) {
      const t = token(w.word)
      if (!t) continue
      this.raw.push(w.word); this.tok.push(t); this.start.push(w.start_ms); this.end.push(Math.max(w.start_ms, w.end_ms))
    }
  }
  get length(): number { return this.tok.length }
  at(i: number): string { return i >= 0 && i < this.tok.length ? this.tok[i] : '' }
  breaksAfter(i: number): boolean {
    if (i < 0 || i + 1 >= this.tok.length) return true
    return END.test(this.raw[i]) || COMMA.test(this.raw[i]) || this.start[i + 1] - this.end[i] >= PAUSE_MS
  }
  opens(i: number): boolean { return this.breaksAfter(i - 1) || OPENERS.has(this.at(i - 1)) }
  text(a: number, b: number): string { const out: string[] = []; for (let k = a; k <= b; k++) { const d = display(this.raw[k]); if (d) out.push(d) } return out.join(' ') }
  matches(i: number, phrase: readonly string[]): boolean { return phrase.every((p, k) => this.at(i + k) === p) }
}

function whereAt(w: Words, i: number, reach = 4): [number, number] | null {
  let k = i
  for (let n = 0; n <= reach; n++) {
    for (const phrase of WHERE_PHRASES) if (w.matches(k, phrase)) return [k, k + phrase.length - 1]
    if (!WHERE_FILLER.has(w.at(k))) return null
    if (k > i && w.breaksAfter(k - 1)) return null
    k++
  }
  return null
}

function leadAfter(w: Words, i: number): [number, number] | null {
  let k = i + 1
  if ((w.at(k) === 'and' || w.at(k) === 'to') && LEAD_STARTS.has(w.at(k + 1))) k++
  if (!LEAD_STARTS.has(w.at(k))) return null
  let end = k
  while (end + 1 < w.length && end - k + 1 < MAX_LEAD_WORDS && !w.breaksAfter(end) && !STOP_AFTER.has(w.at(end + 1))) end++
  if (end - k + 1 < 2 || (end + 1 < w.length && !w.breaksAfter(end) && !STOP_AFTER.has(w.at(end + 1)))) return null
  return [k, end]
}

function keywordAfter(w: Words, i: number, reach = 3): number | null {
  for (let k = i + 1; k < Math.min(w.length, i + 1 + reach); k++) {
    const t = w.at(k)
    if (NOT_KEYWORD.has(t)) {
      if (w.breaksAfter(k) && t !== 'word' && t !== 'the') return null
      continue
    }
    return KEYWORD.test(display(w.raw[k]).replace(/^["“”']+|["“”']+$/g, '')) ? k : null
  }
  return null
}
const keywordText = (w: Words, k: number | null): string => k === null ? '' : display(w.raw[k]).replace(/^["“”']+|["“”']+$/g, '').toUpperCase()

function candidates(w: Words, lo: number, hi: number): Candidate[] {
  const out: Candidate[] = []
  const add = (c: Candidate): void => { out.push(c) }
  for (let i = lo; i <= hi; i++) {
    const t = w.at(i), prev = w.at(i - 1)
    // Someone described doing it ("then you click the link"), not a request (a sentence break before ends that).
    const described = DESCRIBING.has(prev) && !w.breaksAfter(i - 1)
    if (LINK_VERBS.has(t) && !described) {
      for (let k = i + 1; k < Math.min(w.length, i + 2 + MAX_FILLER); k++) {
        if (w.at(k) === 'link' || w.at(k) === 'links') { add({ kind: 'link', a: i, b: k, end: k }); break }
        if (!LINK_FILLER.has(w.at(k)) || w.breaksAfter(k)) break
      }
    }
    // (Not when a request just before already leads to it: "sign up at the link below" is "Sign up", below.)
    if ((t === 'link' || t === 'links') && !out.some((c) => c.kind === 'link' && c.a >= i - 6)) {
      const where = whereAt(w, i + 1, 3)
      if (where && POINTS_DOWN.test(w.text(...where)) && !described) add({ kind: 'link', a: i, b: where[1], end: where[1], buttonWhere: true })
    }
    for (const [phrase, nexts] of SIGNUP) {
      if (!w.matches(i, phrase) || !w.opens(i) || described) continue
      const b = i + phrase.length - 1
      if (nexts.length && !nexts.includes(w.at(b + 1))) continue
      let end = b
      while (end + 1 < w.length && end - i + 1 < 4 && !w.breaksAfter(end) && nexts.length && !STOP_AFTER.has(w.at(end + 1))
        && (nexts.includes(w.at(end + 1)) || nexts.includes(w.at(end))) && !LINK_VERBS.has(w.at(end + 1))) end++
      add({ kind: 'link', a: i, b: end, end })
    }
    if (t === 'comment' && !NOUN_BEFORE.has(prev) && !described && (w.opens(i) || prev === 'and')) {
      const k = keywordAfter(w, i)
      add({ kind: 'comment', a: i, b: k ?? i, end: k ?? i, keyword: keywordText(w, k) })
    }
    if (['type', 'drop', 'write', 'put'].includes(t) && w.opens(i) && !described) {
      const k = keywordAfter(w, i, 2)
      if (k !== null && [1, 2, 3, 4].some((d) => ['comments', 'comment', 'below'].includes(w.at(k + d)))) add({ kind: 'comment', a: i, b: k, end: k, keyword: keywordText(w, k) })
    }
    if ((t === 'leave' || t === 'drop') && (w.at(i + 1) === 'a' || w.at(i + 1) === 'me') && w.at(i + 2) === 'comment' && w.opens(i)) add({ kind: 'comment', a: i, b: i + 2, end: i + 2, keyword: '' })
    if (w.matches(i, ['let', 'me', 'know', 'in', 'the', 'comments']) && w.opens(i)) add({ kind: 'comment', a: i, b: i + 5, end: i + 5, keyword: '' })
    if ((t === 'dm' && w.at(i + 1) === 'me') || (t === 'message' && w.at(i + 1) === 'me' && !NOUN_BEFORE.has(prev))) {
      if (w.opens(i) && !described) { const k = keywordAfter(w, i + 1); add({ kind: 'dm', a: i, b: i + 1, end: k ?? i + 1, keyword: keywordText(w, k) }) }
    }
    if (w.matches(i, ['send', 'me', 'a']) && (w.at(i + 3) === 'dm' || w.at(i + 3) === 'message') && w.opens(i)) {
      const k = keywordAfter(w, i + 3)
      add({ kind: 'dm', a: i, b: i + 3, end: k ?? i + 3, keyword: keywordText(w, k) })
    }
    if (t === 'follow' && w.opens(i) && !described && ['me', 'for', 'along', 'us', 'the', 'my', 'this'].includes(w.at(i + 1))) {
      let end = i + 1
      while (end + 1 < w.length && end - i + 1 < 4 && !w.breaksAfter(end) && !STOP_AFTER.has(w.at(end + 1)) && !LINK_VERBS.has(w.at(end + 1))) end++
      add({ kind: 'follow', a: i, b: end, end })
    }
    if (t === 'hit' && (w.at(i + 1) === 'follow' || w.at(i + 1) === 'subscribe') && w.opens(i)) add({ kind: 'follow', a: i, b: i + 1, end: i + 1 })
    if ((t === 'subscribe' || t === 'subscribed') && w.opens(i) && !described) add({ kind: 'follow', a: i, b: i, end: i })
    if ((t === 'save' || t === 'bookmark') && (w.at(i + 1) === 'this' || w.at(i + 1) === 'it') && w.opens(i) && !described) {
      let end = i + 1
      if (['video', 'post', 'reel'].includes(w.at(i + 2))) end = i + 2
      if (w.at(end + 1) === 'for' && w.at(end + 2) === 'later') end += 2
      add({ kind: 'save', a: i, b: end, end })
    }
    if ((t === 'share' && (w.at(i + 1) === 'this' || w.at(i + 1) === 'it')) || (t === 'send' && w.at(i + 1) === 'this' && w.at(i + 2) === 'to')) {
      if (w.opens(i) && !described) {
        let end = i + 1
        while (end + 1 < w.length && end - i + 1 < 6 && !w.breaksAfter(end) && !STOP_AFTER.has(w.at(end + 1))) end++
        add({ kind: 'share', a: i, b: end, end })
      }
    }
  }
  return out
}

function describe(w: Words, c: Candidate): SpokenCta & { last: number } {
  let end = c.end
  let button = w.text(c.a, Math.min(c.b, c.a + MAX_BUTTON_WORDS - 1))
  let where = ''
  if (c.kind === 'link' && !c.buttonWhere) {
    const spot = whereAt(w, c.b + 1)
    if (spot) { where = w.text(...spot); end = Math.max(end, spot[1]) }
  }
  const keyword = c.keyword ?? ''
  if (c.kind === 'dm' && keyword) button = `${button} ${keyword}`
  let lead = ''
  if (c.kind === 'link' || c.kind === 'dm' || c.kind === 'comment') {
    const after = leadAfter(w, end)
    if (after) { lead = capital(w.text(...after)); end = after[1] }
  }
  let text = capital(button)
  if (c.kind === 'link' && text.toLowerCase().startsWith('link')) text = 'Link' + text.slice(4)
  if (c.kind === 'dm') text = text.replace(/^dm\b/i, 'DM')
  return { kind: c.kind, text, where, keyword: c.kind === 'comment' || c.kind === 'dm' ? keyword : '', lead, start_ms: w.start[c.a], end_ms: w.end[end], last: end }
}

/**
 * The call to action said in `words` (timed, in order). `from_ms`/`until_ms`: only one that starts between them counts
 * (default: anywhere). `pick`: 'best' (the strongest kind, then the latest: the engine's choice) or 'first' (the first
 * one from `from_ms`: the editor's "add it here").
 */
export function spokenCta(words: readonly TimedWord[], options: { from_ms?: number; until_ms?: number; pick?: 'best' | 'first' } = {}): SpokenCta | null {
  const w = new Words(words)
  if (!w.length) return null
  const lo = w.start.findIndex((s) => s >= (options.from_ms ?? -Infinity))
  if (lo < 0) return null
  let hi = w.length - 1
  while (hi >= lo && w.start[hi] > (options.until_ms ?? Infinity)) hi--
  if (hi < lo) return null
  const found = candidates(w, lo, hi)
  if (!found.length) return null
  // One request per phrase: a candidate inside the words of an earlier one ("click the link below to grab it") belongs to it.
  const described: { c: Candidate; d: SpokenCta & { last: number } }[] = []
  let last = -1
  for (const c of [...found].sort((x, y) => x.a - y.a || PRIORITY[y.kind] - PRIORITY[x.kind])) {
    if (c.a <= last) continue
    const d = describe(w, c)
    described.push({ c, d })
    last = d.last
  }
  const chosen = options.pick === 'first' ? described[0]
    : described.reduce((x, y) => PRIORITY[y.c.kind] > PRIORITY[x.c.kind] || (PRIORITY[y.c.kind] === PRIORITY[x.c.kind] && y.c.a >= x.c.a) ? y : x)
  const { last: _last, ...cta } = chosen.d
  void _last
  return cta
}
