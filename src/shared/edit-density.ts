/**
 * Quick controls on the Edit my recording review: one tap that changes how much is on screen, with no new AI call.
 *
 * - Dress it up: the Teaching style (a graphic on each number, list and key point, a sound on each), the planned
 *   graphics the plan kept aside (plan.spareGraphics: the planner's other picks at teaching density, checked against
 *   the words actually said), the planned pop-ups switched back on, and sound effects on.
 * - Keep it clean: only the hook, the numbers, the key diagrams (up to two) and the call to action keep their
 *   automatic graphics; pop-ups that aren't numbers go off. The member's own graphics and pinned images stay.
 *
 * Each returns the new choices and what changed (counts), so the review can say it and offer Undo.
 */
import { isDiagram } from './motion-graphics'
import { MAX_EDIT_GRAPHICS, type EditGraphic } from './reel-graphics'
import { registerKeeps } from './register'
import type { EditDecisions, EditPlan } from './edit-recording'

export type DensityKind = 'dress' | 'clean'

export interface DensityChange {
  kind: DensityKind
  decisions: EditDecisions
  /** Graphics added and removed. */
  added: number
  removed: number
  /** Pop-ups switched on and off. */
  popupsOn: number
  popupsOff: number
  /** The style was set to Teaching (dress it up). */
  styleChanged: boolean
  /** Sound effects were switched on (dress it up). */
  soundOn: boolean
}

/** Spare graphics start at least this many words from another graphic. */
const GAP_WORDS = 6
/** Keep it clean keeps at most this many diagrams. */
const KEY_DIAGRAMS = 2

const isAuto = (g: EditGraphic): boolean => g.origin === 'auto'

/** An automatic graphic that keep it clean keeps: a number, the hook pill, the call to action, a chapter, or a diagram. */
function cleanKeeps(g: EditGraphic): 'keep' | 'diagram' | 'drop' {
  if (!isAuto(g)) return 'keep'
  if (registerKeeps(g, 'minimal')) return 'keep'
  return isDiagram(g.template) ? 'diagram' : 'drop'
}

export function dressItUp(plan: EditPlan, d: EditDecisions): DensityChange {
  const cut = new Set(d.cut)
  const graphics = [...(d.graphics ?? [])]
  let added = 0
  for (const spare of plan.spareGraphics ?? []) {
    if (graphics.length >= MAX_EDIT_GRAPHICS) break
    if (cut.has(spare.word) || graphics.some((g) => g.id === spare.id || Math.abs(g.word - spare.word) < GAP_WORDS)) continue
    graphics.push({ ...spare, fields: { ...spare.fields } })
    added++
  }
  graphics.sort((a, b) => a.word - b.word)
  let popupsOn = 0
  const popups = d.popups.map((item) => {
    const planned = plan.popups.find((p) => p.id === item.id)
    if (item.on || !planned || cut.has(planned.word) || (planned.kind !== 'card' && !item.text.trim())) return item
    popupsOn++
    return { ...item, on: true }
  })
  const styleChanged = (d.soundStyle ?? 'teaching') !== 'teaching' || d.motionGraphics === false
  const soundOn = d.soundEffects === false
  const decisions: EditDecisions = { ...d, graphics, popups, soundStyle: 'teaching', motionGraphics: true,
    ...(soundOn ? { soundEffects: true, sounds: d.sounds.map((s) => ({ ...s, on: true })) } : {}) }
  return { kind: 'dress', decisions, added, removed: 0, popupsOn, popupsOff: 0, styleChanged, soundOn }
}

export function keepItClean(plan: EditPlan, d: EditDecisions): DensityChange {
  let diagrams = 0
  const kept: EditGraphic[] = []
  for (const g of [...(d.graphics ?? [])].sort((a, b) => a.word - b.word)) {
    const verdict = cleanKeeps(g)
    if (verdict === 'keep' || (verdict === 'diagram' && diagrams++ < KEY_DIAGRAMS)) kept.push(g)
  }
  let popupsOff = 0
  const popups = d.popups.map((item) => {
    const planned = plan.popups.find((p) => p.id === item.id)
    if (!item.on || planned?.kind === 'number') return item
    popupsOff++
    return { ...item, on: false }
  })
  const removed = (d.graphics?.length ?? 0) - kept.length
  return { kind: 'clean', decisions: { ...d, graphics: kept, popups }, added: 0, removed, popupsOn: 0, popupsOff, styleChanged: false, soundOn: false }
}

/** How many things changed. */
export function densityCount(change: DensityChange): number {
  return change.added + change.removed + change.popupsOn + change.popupsOff + (change.styleChanged ? 1 : 0) + (change.soundOn ? 1 : 0)
}

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`

/** What changed, in plain words. */
export function densitySummary(change: DensityChange): string {
  const parts: string[] = []
  if (change.added) parts.push(`added ${plural(change.added, 'graphic')}`)
  if (change.removed) parts.push(`removed ${plural(change.removed, 'graphic')}`)
  if (change.popupsOn) parts.push(`turned on ${plural(change.popupsOn, 'pop-up')}`)
  if (change.popupsOff) parts.push(`turned off ${plural(change.popupsOff, 'pop-up')}`)
  if (change.styleChanged) parts.push('set the style to Teaching')
  if (change.soundOn) parts.push('turned on sound effects')
  if (!parts.length) {
    return change.kind === 'dress'
      ? 'Nothing more to add: every planned graphic is already in. Ask the chat to add more.'
      : 'Already clean: only the hook, numbers, key diagrams and the call to action have graphics.'
  }
  const text = parts.join(', ')
  return `${change.kind === 'dress' ? 'Dressed it up' : 'Kept it clean'}: ${text}.`
}
