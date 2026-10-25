/**
 * The Triple Hook Playbook (Paid Creators) for Edit my recording's and Combine clips' headline: which of the three
 * hook elements the spoken hook line and the headline on screen stack together, quoted exactly, and the headline
 * options the plan found (engine edit_frameworks.py; its patterns are mirrored here so the review follows the
 * member's changes live).
 *
 * - Qualifier: a bold line that sets the tone ("I can't stress this enough", "this is gonna be controversial").
 * - Main statement: the result or method, best with an exact number ("$4,365 on ads").
 * - Twist: the false belief it breaks ("without…", "you don't need…", "despite…").
 */

export const TRIPLE_HOOK_ROLES = ['qualifier', 'main_statement', 'twist'] as const
export type TripleHookRole = (typeof TRIPLE_HOOK_ROLES)[number]
export const ROLE_LABELS: Record<TripleHookRole | 'stakes', string> = { qualifier: 'Qualifier', main_statement: 'Main statement', twist: 'Twist', stakes: 'Stakes' }

const NUMW = String.raw`(?:\d[\d,]*(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|a hundred|a thousand|thousand|million|billion)`
const SCALE = String.raw`(?:\s(?:hundred|thousand|million|billion))?`
const UNITS = String.raw`(?:people|leads|clients|customers|sales|buyers|followers|views|subscribers|students|members|steps|ways|things|tips|reasons|lessons|modules|offers|courses|products|orders|deals|signups|downloads|likes|comments|shares|copies|books|days|weeks|months|years|hours|minutes|times|videos|posts|calls)`
const rx = (source: string): RegExp => new RegExp(source, 'i')
const SPECIFIC = [
  String.raw`\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|m|million|thousand|billion)\b)?`,
  String.raw`\b${NUMW}${SCALE}\s?(?:%|percent\b|x\b|k\b|dollars\b|bucks\b)`,
  String.raw`\b${NUMW}${SCALE}(?:\s[a-z]+)?\s${UNITS}\b`
].map(rx)
const VAGUE_RESULT = [
  String.raw`\b(?:make|made|making|earn|earned|earning|generat\w*)\b(?:\s\S+){0,5}?\s(?:money|profit|income|sales|revenue)\b`,
  String.raw`\bprofitable\b`, String.raw`\bwent from\b`, String.raw`\b(?:doubled|tripled)\b`
].map(rx)
const QUALIFIER = [
  String.raw`\byou(?:'re| are) (?:not |never )?(?:going to|gonna) believe\b`,
  String.raw`\bi (?:probably )?(?:shouldn't|should not) (?:be )?(?:tell|say|shar)\w*`,
  String.raw`\b(?:everyone|everybody|most people) (?:thinks?|says?|tells? you|believes?)\b`,
  String.raw`\bthis is (?:the moment|embarrassing)\b`, String.raw`\bcontroversial\b`, String.raw`\bnot to (?:flex|brag)\b`,
  String.raw`\bembarrassing to admit\b`, String.raw`\bi can(?:'t|not| not) stress this enough\b`, String.raw`\bnobody (?:tells|talks|will tell)\b`,
  String.raw`\bhere's the (?:truth|thing)\b`, String.raw`\bthe truth is\b`, String.raw`\bi(?:'m| am) (?:going to|gonna) prove\b`,
  String.raw`\bas an? [a-z]+(?: [a-z]+)?, (?:we|you) (?:both )?know\b`, String.raw`\bmost people are (?:petrified|scared|afraid|terrified)\b`,
  String.raw`\bi never thought\b`
].map(rx)
const TWIST = [
  String.raw`\bwithout\b`, String.raw`\b(?:do not|don't|dont|doesn't|does not) (?:have to|need)\b`, String.raw`\bno need to\b`,
  String.raw`\b(?:despite|even though|even if)\b`, String.raw`\binstead\b`, String.raw`\bneither did i\b`,
  String.raw`\bi(?:'m| am) (?:a )?(?:virtual )?nobody\b`, String.raw`\bnot (?:an?|some) (?:influencer|celebrity|expert|guru)\b`,
  String.raw`\b(?:told me not to|breaking the (?:number one |first )?rule)\b`, String.raw`\bonly (?:worked|spent|took|needed|had|used)\b`
].map(rx)

export interface HookElements { qualifier: boolean; main_statement: boolean; twist: boolean; specific: boolean }

const clean = (text: string): string => text.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim()

/** Which Triple Hook elements a line or a headline has (plain-words patterns, like the engine's). */
export function detectHookElements(text: string): HookElements {
  const t = clean(text)
  const specific = SPECIFIC.some((r) => r.test(t))
  return { qualifier: QUALIFIER.some((r) => r.test(t)), main_statement: specific || VAGUE_RESULT.some((r) => r.test(t)), twist: TWIST.some((r) => r.test(t)), specific }
}

export type ElementSource = 'said' | 'headline' | null

/** Where each element of the opening is: in the spoken hook line ('said'), only in the headline, or missing (null). */
export function openingElements(spoken: string, headline: string): Record<TripleHookRole, ElementSource> & { specific: boolean } {
  const said = detectHookElements(spoken), shown = detectHookElements(headline)
  const where = (role: TripleHookRole): ElementSource => said[role] ? 'said' : shown[role] ? 'headline' : null
  return { qualifier: where('qualifier'), main_statement: where('main_statement'), twist: where('twist'), specific: said.specific || shown.specific }
}

/** The opening's Triple Hook role in a few words, for the beat sheet's first beat ("Triple Hook: twist + main statement · no qualifier"). */
export function tripleHookLabel(spoken: string, headline: string): string {
  const e = openingElements(spoken, headline)
  const have = TRIPLE_HOOK_ROLES.filter((r) => e[r])
  const missing = TRIPLE_HOOK_ROLES.filter((r) => !e[r])
  if (!have.length) return 'Triple Hook: none of the three elements yet'
  const named = have.map((r) => `${ROLE_LABELS[r].toLowerCase()}${e[r] === 'headline' ? ' (headline)' : ''}`).join(' + ')
  return `Triple Hook: ${named}${missing.length ? ` · no ${missing.map((r) => ROLE_LABELS[r].toLowerCase()).join(' or ')}` : ' · all three'}`
}

// ---------------------------------------------------------------------------
// Quotes: the exact words each element is in
// ---------------------------------------------------------------------------

const PATTERNS: Record<TripleHookRole, RegExp[]> = { qualifier: QUALIFIER, main_statement: [...SPECIFIC, ...VAGUE_RESULT], twist: TWIST }

/** The clause of `text` (between , . ; : ! ? —) that holds an element, word for word; null when it isn't there. */
export function elementQuote(text: string, role: TripleHookRole): string | null {
  const t = clean(text)
  const hits = PATTERNS[role].map((r) => r.exec(t)).filter((m): m is RegExpExecArray => m !== null)
  if (!hits.length) return null
  const at = Math.min(...hits.map((m) => m.index))
  const bounds = [...t.matchAll(/[.,;:!?—](?=\s|$)/g)].map((m) => m.index)
  const start = Math.max(-1, ...bounds.filter((b) => b < at)) + 1
  const endAt = bounds.find((b) => b >= at)
  return t.slice(start, endAt === undefined ? t.length : endAt + 1).trim().replace(/^[,;:—\s]+/, '') || null
}

export interface ElementQuote { role: TripleHookRole; quote: string | null; from: 'said' | 'headline' | null }

/** Each element of the opening with its exact words: from the spoken line if it's there, else from the headline. */
export function openingQuotes(spoken: string, headline: string): ElementQuote[] {
  return TRIPLE_HOOK_ROLES.map((role) => {
    const said = elementQuote(spoken, role)
    if (said) return { role, quote: said, from: 'said' }
    const shown = elementQuote(headline, role)
    return shown ? { role, quote: shown, from: 'headline' } : { role, quote: null, from: null }
  })
}

/** A headline option from the engine (edit_frameworks.headline_options): said words that stack more of the Triple Hook. */
export interface HeadlineOption { text: string; adds: TripleHookRole[] }

const MAX_OPTION_CHARS = 90
// eslint-disable-next-line no-control-regex
const PLAIN = /[\u0000-\u001f\u007f<>{}\\]/

/** A hook's headline options, checked (at most three; any that isn't plain text is left out). */
export function parseHeadlineOptions(value: unknown): HeadlineOption[] {
  if (!Array.isArray(value)) return []
  const out: HeadlineOption[] = []
  for (const raw of value.slice(0, 3)) {
    if (typeof raw !== 'object' || raw === null) continue
    const r = raw as Record<string, unknown>
    const text = typeof r.text === 'string' ? r.text.replace(/\s+/g, ' ').trim() : ''
    if (!text || text.length > MAX_OPTION_CHARS || PLAIN.test(text) || out.some((o) => o.text === text)) continue
    const adds = Array.isArray(r.adds) ? r.adds.filter((a): a is TripleHookRole => (TRIPLE_HOOK_ROLES as readonly unknown[]).includes(a)) : []
    out.push({ text, adds })
  }
  return out
}
