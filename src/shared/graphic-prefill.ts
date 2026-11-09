/**
 * Starting words for a new graphic, from what is said where it starts (the
 * transcript's timed words around the playhead, or the transcript line when a
 * run has no word times). Only words that are said are used, in the order they
 * are said, so "Match my words" can time them; nothing is made up. A number
 * said in words ("fourteen hundred") is written in digits ("1,400").
 */
import { spokenCta } from './spoken-cta'
import { fxEffect } from './fx-catalog'
import { GRAPHIC_ITEM_LIMITS, MAX_BIG_WORDS, MAX_GRAPHIC_FIELD_CHARS, type GraphicTemplateId, type TimedWord } from './motion-graphics'

export interface GraphicPrefill {
  fields: Record<string, string>
  /** Source ms where the last word used is said (a list can last until then), or null. */
  last_ms: number | null
  /** Source ms where the first word used is said (a list may start on it), or null. */
  first_ms: number | null
}

/** A pause this long ends a phrase. */
const PHRASE_GAP_MS = 450
/** How far ahead (ms) lists and diagrams look for their items. */
const ITEMS_AHEAD_MS = 12000
const STOP = new Set(('a an the and or but so to of in on at for with is are was were be been being i you we they he she it that this these those my your our their me us them just really very like ' +
  'um uh gonna going go have has had do does did get got can will would could should its it\'s i\'m we\'re you\'re they\'re i\'ve we\'ve if then there here what when how why about all not no yes as by ' +
  'from up out now right okay ok well also need want which who into than too some any one\'s let\'s let actually basically literally obviously obvious kind sort').split(' '))
/** How many items each list-like template starts with. */
const ITEM_COUNT: Partial<Record<GraphicTemplateId, number>> = {
  list: 3, checklist: 3, sticky_notes: 2, icon_pop: 3, orbit: 3, feature_tile: 1, staircase: 4, funnel: 3, journey: 3, growth: 3, idea_hub: 4, compare_marks: 2
}

const key = (w: string): string => w.toLowerCase().replace(/[’']/g, "'").replace(/[^\p{L}\p{N}'%$]+/gu, '')
const tidy = (w: string): string => w.replace(/^[“"‘(]+|[”"’),.;:!?]+$/g, '')
const capital = (text: string): string => text ? text.charAt(0).toUpperCase() + text.slice(1) : text
const titleCase = (text: string): string => text.split(' ').map((w, i) => i > 0 && STOP.has(key(w)) && w.length < 4 ? w : capital(w)).join(' ')
const join = (words: readonly TimedWord[]): string => words.map((w) => tidy(w.word)).filter(Boolean).join(' ')
const fit = (text: string): string => text.slice(0, MAX_GRAPHIC_FIELD_CHARS)

const UNITS: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000, million: 1e6, billion: 1e9 }

/** A number said from word `i` (digits, or number words): its text in digits and how many words it took, or null. */
export function spokenNumber(words: readonly TimedWord[], i: number, allowOne = false): { text: string; count: number } | null {
  const first = tidy(words[i]?.word ?? '')
  if (/\d/.test(first)) {
    let text = first, count = 1
    const next = key(words[i + 1]?.word ?? '')
    if (next === 'percent') { text += '%'; count++ } else if (SCALES[next] && SCALES[next] >= 1000) { text += ` ${next}`; count++ }
    return { text, count }
  }
  let total = 0, current = 0, count = 0, any = false
  for (let k = i; k < words.length && k < i + 8; k++) {
    const w = key(words[k].word)
    // "eighty-eight" (one hyphenated word) is two number words.
    const pair = words[k].word.toLowerCase().split('-').map(key)
    if (pair.length === 2 && UNITS[pair[0]] !== undefined && UNITS[pair[1]] !== undefined) { current += UNITS[pair[0]] + UNITS[pair[1]]; any = true; count++ }
    else if (UNITS[w] !== undefined) { current += UNITS[w]; any = true; count++ } else if (SCALES[w] && any) { current = (current || 1) * (SCALES[w] < 1000 ? SCALES[w] : 1); if (SCALES[w] >= 1000) { total += current * SCALES[w]; current = 0 } count++ }
    else if (w === 'and' && any && UNITS[key((words[k + 1]?.word ?? '').split('-')[0])] !== undefined) count++
    else break
  }
  if (!any) return null
  const value = total + current
  // "one" alone is usually not a stat ("one thing"): keep numbers from two up, or with a scale word.
  if (value < 2 && count < 2 && !allowOne) return null
  let text = value.toLocaleString('en-US')
  const after = key(words[i + count]?.word ?? '')
  if (after === 'percent') { text += '%'; count++ } else if (after === 'dollars' || after === 'bucks') { text = `$${text}`; count++ }
  return { text, count }
}

/** The phrases said from word `from` for up to `aheadMs`: split at pauses, at sentence ends and at "and"/"then" after a few words. */
function phrases(words: readonly TimedWord[], from: number, aheadMs: number): TimedWord[][] {
  const out: TimedWord[][] = []
  if (from < 0 || from >= words.length) return out
  const until = words[from].start_ms + aheadMs
  let current: TimedWord[] = []
  for (let i = from; i < words.length && words[i].start_ms <= until; i++) {
    const w = words[i], prev = words[i - 1]
    const gap = prev && i > from ? w.start_ms - prev.end_ms : 0
    const connector = (['and', 'then', 'or', 'but', 'so'].includes(key(w.word)) || (key(w.word) === 'now' && !['right', 'for', 'until', 'just'].includes(key(prev?.word ?? '')))) && current.length >= 3
    // A list said with the same opener ("we need a product… we need an offer…"): each item starts a new phrase.
    const again = current.length >= 3 && key(w.word) === key(current[0].word) && key(words[i + 1]?.word ?? '') === key(current[1].word)
    if (current.length && (gap > PHRASE_GAP_MS || connector || again || current.length >= 9 || /[.!?;]$/.test(prev?.word ?? ''))) { out.push(current); current = [] }
    if (connector) continue
    current.push(w)
  }
  if (current.length) out.push(current)
  return out
}

/** An item worth showing: more than one short word ("See", "Talk" alone say little). */
const goodItem = (p: readonly TimedWord[]): boolean => p.length > 1 || key(p[0]?.word ?? '').length > 4

/** A phrase's key words: without the small words it starts and ends with, at most `max` words. */
function keyWords(phrase: readonly TimedWord[], max: number): TimedWord[] {
  let start = 0
  while (start < phrase.length - 1 && STOP.has(key(phrase[start].word))) start++
  // "Number three: a way to…" starts on what comes after the number.
  if (['number', 'step', 'part'].includes(key(phrase[start]?.word ?? ''))) { const n = spokenNumber(phrase, start + 1, true); if (n && start + 1 + n.count < phrase.length) { start += 1 + n.count; while (start < phrase.length - 1 && STOP.has(key(phrase[start].word))) start++ } }
  const picked = phrase.slice(start, start + max)
  let end = picked.length
  while (end > 1 && STOP.has(key(picked[end - 1].word))) end--
  return picked.slice(0, end)
}

/** Two words said one after the other that carry the phrase (the longest pair of non-small words). */
function strongPair(phrase: readonly TimedWord[]): TimedWord[] {
  let best: TimedWord[] = phrase.slice(0, 2), score = -1
  for (let i = 0; i < phrase.length; i++) {
    for (const size of [2, 1]) {
      const pick = phrase.slice(i, i + size)
      if (pick.length < size || pick.some((w) => STOP.has(key(w.word)))) continue
      const letters = pick.reduce((n, w) => n + key(w.word).length, 0) + (size === 2 ? 3 : 0)
      if (letters > score) { best = pick; score = letters }
    }
  }
  return best.slice(0, MAX_BIG_WORDS)
}

/** The transcript line as untimed words (a run without word times): a long pause at each punctuation mark. */
export function lineWords(line: string | undefined, at = 0): TimedWord[] {
  let t = at
  return (line ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).map((word) => {
    const w = { word, start_ms: t, end_ms: t + 250 }
    t += /[,.;:!?]$/.test(word) ? 1250 : 300
    return w
  })
}

/**
 * Starting words for `template` at `at` (source ms): from `words` (timed, the whole transcript or the part around
 * the clip), or from `line` when there are none. `until`: the clip's end (source ms); words after it aren't used.
 */
export function prefillGraphic(template: GraphicTemplateId, words: readonly TimedWord[], at: number, options: { line?: string; until?: number } = {}): GraphicPrefill {
  const timed = words.length > 0
  const said = timed ? words.filter((w) => w.start_ms <= (options.until ?? Infinity)) : lineWords(options.line, at)
  // The word being said at the playhead (or the next one).
  const from = said.findIndex((w) => w.end_ms > at - 40)
  const none: GraphicPrefill = { fields: {}, last_ms: null, first_ms: null }
  if (from < 0) return none
  // The phrase being said at the playhead (from its start, so a card can land on its first word), or the next one
  // when the playhead is on the last words of a phrase.
  const back = Math.max(0, said.findIndex((w) => w.start_ms >= said[from].start_ms - 6000))
  const all = phrases(said, back, said[from].start_ms - said[back].start_ms + (timed ? ITEMS_AHEAD_MS : 1e9))
  // (A joining word like "and" belongs to no phrase: the next phrase then.)
  let k = all.findIndex((p) => p.includes(said[from]))
  if (k < 0) k = Math.max(0, all.findIndex((p) => p[0].start_ms >= said[from].start_ms))
  if (all[k] && all[k + 1] && all[k].length >= 2 && all[k].indexOf(said[from]) === all[k].length - 1) k++
  const list = all.slice(k)
  const phrase = list[0] ?? []
  if (!phrase.length) return none
  const done = (fields: Record<string, string>, used: readonly TimedWord[]): GraphicPrefill => {
    const clean: Record<string, string> = {}
    for (const [k, v] of Object.entries(fields)) if (v && v.trim()) clean[k] = k === 'items' ? v.slice(0, MAX_GRAPHIC_FIELD_CHARS * 5) : fit(v)
    return { fields: clean, last_ms: used.length ? Math.max(...used.map((w) => w.end_ms)) : null, first_ms: used.length ? Math.min(...used.map((w) => w.start_ms)) : null }
  }
  // Text cards start on the phrase's first key word ("we're gonna need a product…" → "Product…").
  const line = (n: number): TimedWord[] => keyWords(phrase, n)
  switch (template) {
    case 'title': return done({ text: capital(join(line(5))) }, line(5))
    case 'big_words': { const pair = strongPair(phrase); return done({ text: capital(join(pair)) }, pair) }
    case 'statement': return done({ text: capital(join(line(7))) }, line(7))
    // The whole short line as said (up to 9 words), its strongest word as the accent.
    case 'takeover': { const said9 = phrase.slice(0, 9); return done({ text: capital(join(said9)), accent: join(strongPair(said9).slice(-1)) }, said9) }
    case 'browser_frame': return done({ title: capital(join(line(6))) }, line(6))
    case 'headline_pill': {
      const words8 = line(8), half = Math.max(1, Math.ceil(words8.length / 2))
      return done({ text: capital(join(words8.slice(0, half))), phrase: join(words8.slice(half)) }, words8)
    }
    case 'quote': { const words14 = [...phrase, ...(list[1] ?? [])].slice(0, 14); return done({ text: capital(join(words14)) }, words14) }
    case 'chapter': {
      const k0 = key(phrase[0].word)
      const n = (k0 === 'step' || k0 === 'number' || k0 === 'part') ? spokenNumber(phrase, 1, true) : null
      const title = keyWords(phrase.slice(n ? 1 + n.count : 0), 5)
      return done({ ...(n ? { label: `${capital(k0)} #${n.text}.` } : {}), title: titleCase(join(title)) }, title)
    }
    case 'stat': {
      const end = Math.min(said.length, from + 40)
      for (let i = from; i < end; i++) {
        const n = spokenNumber(said, i)
        if (!n) continue
        // The words right after it, up to the next small word or pause ("3 years", "1,400 times").
        const label: TimedWord[] = []
        for (const w of said.slice(i + n.count, i + n.count + 4)) {
          if (label.length && (STOP.has(key(w.word)) || w.start_ms - label[label.length - 1].end_ms > PHRASE_GAP_MS)) break
          if (!label.length && STOP.has(key(w.word))) continue
          label.push(w)
        }
        return done({ value: n.text, label: join(label) }, [...said.slice(i, i + n.count), ...label])
      }
      return none
    }
    case 'comment_cta': {
      const i = said.findIndex((w, k) => k >= from && key(w.word) === 'comment' && !!said[k + 1])
      return i < 0 ? none : done({ keyword: tidy(said[i + 1].word).toUpperCase() }, [said[i], said[i + 1]])
    }
    case 'link_cta': {
      // The call to action said from here on (the speaker's own words on the button), else nothing.
      const cta = spokenCta(said, { from_ms: phrase[0].start_ms, until_ms: said[from].start_ms + ITEMS_AHEAD_MS, pick: 'first' })
      if (!cta) return none
      const used = said.filter((w) => w.start_ms >= cta.start_ms && w.start_ms <= cta.end_ms)
      return done({ text: cta.text, where: cta.where, lead: cta.lead, kind: cta.kind === 'link' ? '' : cta.kind }, used)
    }
    case 'before_after': {
      const items = list.map((p) => keyWords(p, 3)).filter(goodItem).slice(0, 2)
      return done({ before: capital(join(items[0] ?? [])), after: capital(join(items[1] ?? [])) }, items.flat())
    }
    case 'strike_list': {
      const items = list.map((p) => keyWords(p, 3)).filter(goodItem).slice(0, 3)
      return done({ items: items.slice(0, -1).map((p) => capital(join(p))).join('\n'), final: capital(join(items.at(-1) ?? [])) }, items.flat())
    }
    case 'lower_third': case 'logo': case 'highlight': case 'screen_frame': return none
    default: {
      const count = Math.min(ITEM_COUNT[template] ?? 3, GRAPHIC_ITEM_LIMITS[template] ?? 5)
      const items = list.map((p) => keyWords(p, 3)).filter(goodItem).slice(0, count)
      return done({ items: items.map((p) => capital(join(p))).join('\n') }, items.flat())
    }
  }
}

const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 }
const STEP_WORDS = ['step', 'number', 'part', 'tip', 'rule', 'lesson', 'phase']

/** A step the speaker names: where it starts (source ms), its label as said ("Step #2.", "Second.") and the words after it. */
export interface SpokenStep { at_ms: number; label: string; title: string; end_ms: number }

/**
 * The steps the speaker names inside `ranges` (source ms): "step one…", "number two…", "part 3…", or a sentence that
 * starts with "first", "second"… Each with the words said right after it (its title, up to 5 words). Nothing is
 * made up: the label and title are the speaker's words.
 */
export function spokenSteps(words: readonly TimedWord[], ranges: readonly [number, number][]): SpokenStep[] {
  const inside = (t: number): boolean => ranges.some(([a, b]) => t >= a && t < b)
  const out: SpokenStep[] = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (!inside(w.start_ms)) continue
    const k = key(w.word), prev = words[i - 1]
    const opens = !prev || w.start_ms - prev.end_ms > 250 || /[.!?;:,]$/.test(prev.word)
    let label = '', next = -1
    if (STEP_WORDS.includes(k)) {
      const n = spokenNumber(words, i + 1, true)
      if (n && /^\d+$/.test(n.text) && Number(n.text) <= 20) { label = `${capital(k)} #${n.text}.`; next = i + 1 + n.count }
    } else if (ORDINALS[k] && opens) {
      label = `${capital(tidy(w.word))}.`; next = i + 1
    }
    if (next < 0) continue
    const after: TimedWord[] = []
    for (let j = next; j < words.length && after.length < 8; j++) {
      if (after.length && (words[j].start_ms - words[j - 1].end_ms > PHRASE_GAP_MS || ['and', 'then', 'so', 'but', 'or'].includes(key(words[j].word)) || /[.!?;:,]$/.test(words[j - 1].word))) break
      after.push(words[j])
    }
    const title = keyWords(after.filter((x) => x.word.replace(/[^\p{L}\p{N}]/gu, '')), 5)
    if (!title.length) continue
    if (out.length && w.start_ms - out[out.length - 1].at_ms < 1500) continue
    out.push({ at_ms: w.start_ms, label, title: titleCase(join(title)), end_ms: title[title.length - 1].end_ms })
  }
  return out
}

/** Fields picked from the main line rather than filled with a phrase of their own (a word to mark in it). */
const FROM_LINE = ['word', 'underline', 'emphasis']

/**
 * Starting words for an effect (fx-catalog.ts) at `at`: a number said there for its number field, the phrases said
 * from there for its text fields (one phrase each, cut to fit), the next phrases as its list's items, and a word to
 * mark taken from its line. Only words said, in the order said; empty when nothing fits.
 */
export function prefillEffect(effectId: string, words: readonly TimedWord[], at: number, options: { line?: string; until?: number } = {}): GraphicPrefill {
  const effect = fxEffect(effectId)
  const none: GraphicPrefill = { fields: {}, last_ms: null, first_ms: null }
  if (!effect) return none
  const timed = words.length > 0
  const said = timed ? words.filter((w) => w.start_ms <= (options.until ?? Infinity)) : lineWords(options.line, at)
  const from = said.findIndex((w) => w.end_ms > at - 40)
  if (from < 0) return none
  const back = Math.max(0, said.findIndex((w) => w.start_ms >= said[from].start_ms - 6000))
  const all = phrases(said, back, said[from].start_ms - said[back].start_ms + (timed ? ITEMS_AHEAD_MS : 1e9))
  let k = all.findIndex((p) => p.includes(said[from]))
  if (k < 0) k = Math.max(0, all.findIndex((p) => p[0].start_ms >= said[from].start_ms))
  const list = all.slice(k).filter((p) => p.length)
  const fields: Record<string, string> = {}
  const used: TimedWord[] = []
  // A number said from here on: its digits, and what is said around it (%, $) for the effect's own affixes.
  const numberField = effect.fields.find((f) => f.kind === 'number' && f.said && f.required) ?? effect.fields.find((f) => f.key === 'value' && f.kind === 'text')
  if (numberField) {
    for (let i = from; i < Math.min(said.length, from + 40); i++) {
      const n = spokenNumber(said, i)
      if (!n) continue
      const m = /^([^\d]*)([\d,]+(?:\.\d+)?)(.*)$/.exec(n.text)
      if (!m) continue
      fields[numberField.key] = numberField.kind === 'number' ? m[2].replaceAll(',', '') : m[2]
      const affix = (key: string, value: string): void => { if (value.trim() && effect.fields.some((f) => f.key === key)) fields[key] = value.trim() }
      affix('prefix', m[1]); affix('suffix', m[3]); affix('unit', m[3])
      if (effect.fields.some((f) => f.key === 'label' && f.kind === 'text') && effect.id === 'conic-progress-ring') fields.label = n.text
      used.push(...said.slice(i, i + n.count))
      break
    }
    if (!used.length) return none
  }
  let next = 0
  // With a number, the effect is about it: its other words (a label, a unit) are left to the member.
  // Names are never filled from what is said near it (only the member types one).
  const texts = numberField ? [] : effect.fields.filter((f) => f.kind === 'text' && f.said && !f.manual && !FROM_LINE.includes(f.key))
  for (const f of texts.filter((t) => t.required).concat(texts.filter((t) => !t.required)).slice(0, 2)) {
    const phrase = list[next++]
    if (!phrase) break
    const most = Math.max(1, Math.min(7, Math.round((f.max ?? 40) / 6)))
    const picked = most <= 2 ? strongPair(phrase).slice(0, most) : keyWords(phrase, most)
    if (!picked.length) continue
    fields[f.key] = fit(capital(join(picked)).slice(0, f.max ?? MAX_GRAPHIC_FIELD_CHARS))
    used.push(...picked)
    // A word to mark in this line: its strongest word.
    const mark = effect.fields.find((x) => FROM_LINE.includes(x.key))
    if (mark && !fields[mark.key] && picked.length > 1) { const w = strongPair(picked)[0]; if (w) fields[mark.key] = tidy(w.word) }
  }
  const listField = effect.fields.find((f) => f.kind === 'list' && f.said && f.required)
  if (listField && !numberField) {
    const items = list.slice(next).map((p) => keyWords(p, 2)).filter(goodItem).slice(0, 4)
    if (items.length) { fields[listField.key] = items.map((p) => capital(join(p))).join('\n'); used.push(...items.flat()) }
  }
  if (!Object.keys(fields).length) return none
  return { fields, last_ms: used.length ? Math.max(...used.map((w) => w.end_ms)) : null, first_ms: used.length ? Math.min(...used.map((w) => w.start_ms)) : null }
}
