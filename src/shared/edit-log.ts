/**
 * "What changed": a plain list of what the app did to a clip or a reel on its
 * own (cut pauses, moved the start, added graphics, captions, hook text…), each
 * line with a Restore that puts just that piece back.
 *
 * Lines are worked out from what was saved: an Automatic clip's baseline
 * (EditorCandidate.auto, written when the run is opened in the editor), the
 * graphics marked as added automatically, the Edit my recording plan, and a
 * remix take. Every number is counted from that data; nothing is guessed.
 * A line only shows while the app's change is still in place, so a Restore
 * makes its line go away (and Undo brings it back).
 */
import { CAPTION_PRESETS } from './caption-presets'
import { fitCropToAspect, type CandidateEdit, type EditorCandidate, type EditorProject, type EditorRange, type EditorScene } from './clip-editor'
import { graphicItems, type EditorGraphic } from './motion-graphics'
import { SOUND_LABELS, chooseHook, type CutReason, type EditDecisions, type EditPlan } from './edit-recording'

export interface EditLogLine<P> {
  /** Stable per kind of change (tests and the UI's keys). */
  id: string
  text: string
  /** What Restore applies; absent when there is nothing the app can put back. */
  restore?: P
  /** What Restore does, in words (the button's tooltip). */
  restoreHint?: string
}

/** A start or end moved by less than this is just the cut snapping to words: not listed. */
export const EDGE_MIN_MS = 400

/** m:ss (or h:mm:ss) of a time in ms. */
export function logClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}
/** Seconds for a line: one decimal under 10 s, whole seconds above. */
export function logSeconds(ms: number): string {
  const s = Math.max(0, ms) / 1000
  return s < 10 ? `${(Math.round(s * 10) / 10).toFixed(1).replace(/\.0$/, '')} s` : `${Math.round(s)} s`
}
/** Seconds with one decimal, as m:ss.s. */
const tenths = (ms: number): string => { const s = Math.max(0, ms) / 1000; return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}` }
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`
const short = (text: string, max = 48): string => {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

// ---------------------------------------------------------------------------
// Clip editor (an Automatic run's clips)
// ---------------------------------------------------------------------------

type ClipPatch = Partial<CandidateEdit>
type ProjectShape = Pick<EditorProject, 'width' | 'height' | 'aspect_ratio' | 'duration_ms'>

/** A graphic in a few words, from its own fields ("$1,200/month stat", "3-step list"). */
export function graphicPhrase(g: Pick<EditorGraphic, 'template' | 'fields'>): string {
  const f = g.fields
  switch (g.template) {
    case 'stat': { const v = short(f.value || f.label || '', 24); return v ? `${v} stat` : 'stat' }
    case 'list': { const n = graphicItems(f.items).length; return n ? `${n}-step list` : 'list' }
    case 'checklist': { const n = graphicItems(f.items).length; return n ? `${n}-item checklist` : 'checklist' }
    case 'title': return f.text?.trim() ? `“${short(f.text, 24)}” title` : 'title'
    case 'quote': return 'quote card'
    case 'lower_third': return 'name tag'
    case 'before_after': return 'before/after'
    case 'logo': return 'logo'
    case 'highlight': return f.shape === 'arrow' ? 'arrow' : 'circle'
  }
}

/** Source time → time in the finished clip (ms), through the cuts and speed; a cut-out time maps to the next kept moment. */
export function clipTime(c: Pick<CandidateEdit, 'ranges' | 'video_speed'>, t: number): number {
  let before = 0
  for (const [a, b] of c.ranges) {
    if (t < a) break
    if (t <= b) return (before + t - a) / c.video_speed
    before += b - a
  }
  return before / c.video_speed
}

/** Current ranges with each of the given gaps (exactly between two neighboring ranges) filled back in. */
function fillGaps(ranges: EditorRange[], gaps: EditorRange[]): EditorRange[] {
  const out: EditorRange[] = []
  for (const r of ranges) {
    const last = out[out.length - 1]
    if (last && gaps.some(([a, b]) => a === last[1] && b === r[0])) last[1] = r[1]
    else out.push([r[0], r[1]])
  }
  return out
}

/**
 * The "What changed" lines for one clip of a project made from an Automatic run.
 * Without a saved baseline (older projects, added clips) only graphics the run
 * added are listed (they are marked as automatic).
 */
export function clipEditLog(project: ProjectShape, c: EditorCandidate): EditLogLine<ClipPatch>[] {
  const lines: EditLogLine<ClipPatch>[] = []
  const b = c.auto
  const first = c.ranges[0], last = c.ranges[c.ranges.length - 1]
  if (b?.moment && b.ranges?.length) {
    const [m0, m1] = b.moment
    const start = b.ranges[0][0], end = b.ranges[b.ranges.length - 1][1]
    // Only while the clip still starts (ends) where the run cut it.
    if (first[0] === start && Math.abs(start - m0) >= EDGE_MIN_MS) {
      const restore = m0 < first[1] - 100 ? { ranges: [[m0, first[1]] as EditorRange, ...c.ranges.slice(1)] } : undefined
      lines.push(start > m0
        ? { id: 'start', text: `Started at ${logClock(start)} (left out ${logSeconds(start - m0)} before${b.before_words ? `: “${b.before_words}”` : ''})`,
            restore, restoreHint: `Start at ${logClock(m0)} again, with the ${logSeconds(start - m0)} put back` }
        : { id: 'start', text: `Started ${logSeconds(m0 - start)} before the picked moment (at ${logClock(start)})`,
            restore, restoreHint: `Start at the picked moment, ${logClock(m0)}` })
    }
    if (last[1] === end && Math.abs(m1 - end) >= EDGE_MIN_MS) {
      const bound = Math.min(project.duration_ms, m1)
      const restore = bound > last[0] + 100 ? { ranges: [...c.ranges.slice(0, -1), [last[0], bound] as EditorRange] } : undefined
      lines.push(end < m1
        ? { id: 'end', text: `Ended at ${logClock(end)} (left out ${logSeconds(m1 - end)} after${b.after_words ? `: “${b.after_words}”` : ''})`,
            restore, restoreHint: `End at ${logClock(bound)} again, with the ${logSeconds(m1 - end)} put back` }
        : { id: 'end', text: `Ended ${logSeconds(end - m1)} after the picked moment (at ${logClock(end)})`,
            restore, restoreHint: `End at the picked moment, ${logClock(bound)}` })
    }
  }
  if (b?.ranges && b.ranges.length > 1) {
    // Gaps the run cut that are still cut exactly (the ranges on both sides untouched).
    const gaps = b.ranges.slice(1).map((r, i) => [b.ranges![i][1], r[0]] as EditorRange)
      .filter(([a, z]) => c.ranges.some((r, i) => r[1] === a && c.ranges[i + 1]?.[0] === z))
    if (gaps.length) {
      const total = gaps.reduce((n, [a, z]) => n + z - a, 0)
      lines.push({ id: 'pauses', text: `Cut ${plural(gaps.length, 'pause')} (${logSeconds(total)})`,
        restore: { ranges: fillGaps(c.ranges, gaps) }, restoreHint: `Put the ${plural(gaps.length, 'pause')} back (${logSeconds(total)})` })
    }
  }
  const auto = (c.graphics ?? []).filter((g) => g.origin === 'auto')
  if (auto.length) {
    const words = auto.slice(0, 3).map(graphicPhrase)
    const more = auto.length > 3 ? ` and ${auto.length - 3} more` : ''
    lines.push({ id: 'graphics', text: `Added ${plural(auto.length, 'graphic')}: ${words.join(', ')}${more}`,
      restore: { graphics: (c.graphics ?? []).filter((g) => g.origin !== 'auto') }, restoreHint: `Remove the ${plural(auto.length, 'graphic')} the app added` })
  }
  if (b?.split_at.length) {
    const at = new Set(b.split_at)
    const splits = c.scenes.map((s, i) => ({ s, i })).filter(({ s }) => s.layout === 'split' && at.has(s.at_ms))
    const clipEnd = last[1]
    const spans = splits.map(({ i }) => {
      const from = Math.max(first[0], c.scenes[i].at_ms), to = Math.min(clipEnd, c.scenes[i + 1]?.at_ms ?? clipEnd)
      return to > from ? [clipTime(c, from), clipTime(c, to)] as const : null
    }).filter((x): x is readonly [number, number] => !!x && x[1] - x[0] >= 100)
    if (spans.length) {
      const aspect = project.aspect_ratio === '9:16' ? 9 / 16 : 16 / 9
      const indices = new Set(splits.map(({ i }) => i))
      const scenes = c.scenes.map((s, i): EditorScene => indices.has(i)
        ? { at_ms: s.at_ms, layout: 'fill', crops: [fitCropToAspect(s.crops[0], aspect, project.width, project.height)] } : s)
      const shown = spans.slice(0, 3).map(([a, z]) => logClock(a) === logClock(z) ? `${tenths(a)}–${tenths(z)}` : `${logClock(a)}–${logClock(z)}`).join(', ') + (spans.length > 3 ? ` and ${spans.length - 3} more` : '')
      lines.push({ id: 'split', text: `Split screen ${shown}`, restore: { scenes },
        restoreHint: `Use the full frame there instead (framed like the top half)` })
    }
  }
  if (b?.captions && c.captions && c.caption_preset === b.caption_preset) {
    const name = CAPTION_PRESETS.find((p) => p.id === b.caption_preset)?.name ?? b.caption_preset
    lines.push({ id: 'captions', text: `Captions: ${name}`, restore: { captions: false }, restoreHint: 'Turn captions off for this clip' })
  }
  if (b?.hook && c.hook && c.hook.text === b.hook) {
    lines.push({ id: 'hook', text: `Hook text: “${short(b.hook)}”`, restore: { hook: null }, restoreHint: 'Remove the hook text from this clip' })
  }
  return lines
}

// ---------------------------------------------------------------------------
// Edit my recording (the review before the reel is made)
// ---------------------------------------------------------------------------

type EditPatch = Partial<EditDecisions>
const CUT_GROUPS: { id: string; reasons: CutReason[]; one: string; many: string }[] = [
  { id: 'retakes', reasons: ['retake', 'rejected', 'cue'], one: 'retake', many: 'retakes' },
  { id: 'false-starts', reasons: ['false_start'], one: 'false start', many: 'false starts' },
  { id: 'filler', reasons: ['filler'], one: 'filler word', many: 'filler words' },
  { id: 'off-topic', reasons: ['off_topic'], one: 'off-topic part', many: 'off-topic parts' }
]

/** Runs of neighboring words the plan cut for one of `reasons` (same take). */
function cutSpans(plan: EditPlan, reasons: CutReason[]): number[][] {
  const spans: number[][] = []
  plan.words.forEach((w, i) => {
    if (!w.cut || !reasons.includes(w.cut)) return
    const last = spans[spans.length - 1]
    const prev = plan.words[i - 1]
    if (last && last[last.length - 1] === i - 1 && prev?.src === w.src && prev.cut && reasons.includes(prev.cut)) last.push(i)
    else spans.push([i])
  })
  return spans
}
const spanMs = (plan: EditPlan, span: number[]): number => plan.words[span[span.length - 1]].endMs - plan.words[span[0]].startMs

/** The "What changed" lines for Edit my recording's review. Restore patches go through the review's own setters. */
export function editRecordingLog(plan: EditPlan, d: EditDecisions): EditLogLine<EditPatch>[] {
  const lines: EditLogLine<EditPatch>[] = []
  const cut = new Set(d.cut)
  for (const group of CUT_GROUPS) {
    // Still cut as planned: every word of the span is still cut.
    const spans = cutSpans(plan, group.reasons).filter((span) => span.every((i) => cut.has(i)))
    if (!spans.length) continue
    const total = spans.reduce((n, s) => n + spanMs(plan, s), 0)
    const words = new Set(spans.flat())
    const count = group.id === 'filler' ? words.size : spans.length
    lines.push({ id: group.id, text: `Cut ${plural(count, group.one, group.many)} (${logSeconds(total)})`,
      restore: { cut: d.cut.filter((i) => !words.has(i)) }, restoreHint: `Keep ${count === 1 ? 'it' : 'them'} in the reel` })
  }
  const hook = plan.hooks.find((h) => h.id === plan.hook)
  if (hook && d.hookId === hook.id) {
    const words = plan.words.slice(hook.start, hook.end + 1).filter((_, k) => !cut.has(hook.start + k)).map((w) => w.text).join(' ')
    const first = plan.words[hook.start]
    // It only moved when something plays before it in the recording.
    const moved = plan.words.slice(0, hook.start).some((_, i) => !cut.has(i))
    if (words) {
      const restored = chooseHook(plan, d, null)
      lines.push({ id: 'hook', text: `Opened with “${short(words, 40)}”${moved ? ` (moved from ${plan.words.some((w) => w.src > 0) ? `take ${first.src + 1}, ` : ''}${logClock(first.startMs)})` : ''}`,
        restore: { hookId: restored.hookId, hookText: restored.hookText, cut: restored.cut }, restoreHint: 'Start from the beginning, as recorded' })
    }
  }
  if (plan.cta && d.endOnCta) {
    lines.push({ id: 'cta', text: 'Moved your call to action to the end', restore: { endOnCta: false }, restoreHint: 'Leave it where you said it' })
  }
  const shown = (id: number): boolean => { const p = plan.popups.find((x) => x.id === id); return !!p && !cut.has(p.word) }
  const cards = d.popups.filter((p) => p.on && plan.popups.find((x) => x.id === p.id)?.kind === 'card' && shown(p.id))
  if (cards.length) {
    const ids = new Set(cards.map((c) => c.id))
    lines.push({ id: 'cards', text: `Added ${plural(cards.length, 'card')}`, restore: { popups: d.popups.map((p) => ids.has(p.id) ? { ...p, on: false } : p) }, restoreHint: `Turn ${cards.length === 1 ? 'it' : 'them'} off` })
  }
  const pops = d.popups.filter((p) => p.on && plan.popups.find((x) => x.id === p.id)?.kind !== 'card' && shown(p.id))
  if (pops.length) {
    const ids = new Set(pops.map((c) => c.id))
    lines.push({ id: 'popups', text: `Added ${plural(pops.length, 'pop-up')}`, restore: { popups: d.popups.map((p) => ids.has(p.id) ? { ...p, on: false } : p) }, restoreHint: `Turn ${pops.length === 1 ? 'it' : 'them'} off` })
  }
  const sounds = d.sounds.filter((s) => s.on && plan.sounds.some((x) => x.id === s.id && (x.at === 'title' || !cut.has(x.at))))
  if (sounds.length) {
    const kinds = [...new Set(sounds.map((s) => plan.sounds.find((x) => x.id === s.id)!.sound))].map((k) => SOUND_LABELS[k].toLowerCase())
    lines.push({ id: 'sounds', text: `Sound effects ×${sounds.length} (${kinds.join(', ')})`, restore: { sounds: d.sounds.map((s) => sounds.includes(s) ? { ...s, on: false } : s) }, restoreHint: 'Turn the sound effects off' })
  }
  if (d.cutoutIntro) lines.push({ id: 'cutout', text: 'Cut-out opening on', restore: { cutoutIntro: false }, restoreHint: 'Turn the cut-out opening off' })
  if (d.rawIntro) lines.push({ id: 'raw', text: 'Raw-to-edited opening on', restore: { rawIntro: false }, restoreHint: 'Turn the raw-to-edited opening off' })
  return lines
}

// ---------------------------------------------------------------------------
// Remix reviews (lighter: what was picked, and the take's trim)
// ---------------------------------------------------------------------------

export type RemixLogAction = 'use-whole-take'

export function remixEditLog(input: {
  /** The part of their video used (ms in their video). */
  startMs: number; endMs: number
  /** The member's take as recorded, and the part of it used (from the chat), if trimmed. */
  take?: { seconds: number; trim?: { startMs: number; endMs: number } } | null
  /** The hook text the AI wrote, and the one on the page now. */
  aiHeadline: string; headline: string
}): EditLogLine<RemixLogAction>[] {
  const lines: EditLogLine<RemixLogAction>[] = []
  if (input.endMs > input.startMs) lines.push({ id: 'their-clip', text: `Used ${logClock(input.startMs)}–${logClock(input.endMs)} of their clip (${logSeconds(input.endMs - input.startMs)})` })
  const trim = input.take?.trim
  if (trim && input.take) {
    lines.push({ id: 'take-trim', text: `Your take trimmed to ${tenths(trim.startMs)}–${tenths(trim.endMs)} (${logSeconds(trim.endMs - trim.startMs)} of ${logSeconds(input.take.seconds * 1000)})`,
      restore: 'use-whole-take', restoreHint: 'Use all of your take' })
  }
  if (input.aiHeadline.trim() && input.headline.trim() === input.aiHeadline.trim()) lines.push({ id: 'hook', text: `Hook: “${short(input.aiHeadline)}”` })
  return lines
}
