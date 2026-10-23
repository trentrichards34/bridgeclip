/**
 * What an Edit my recording / Combine clips run is doing, in stages, for the progress view. Built in main from the
 * phases and progress lines the run already reports (nothing here changes what the run does), and read by the page
 * and the sidebar. Only measured times and counts: nothing is guessed here.
 */

export const EDIT_STAGE_IDS = ['ready', 'listen', 'plan', 'review', 'graphics', 'cut', 'sound', 'layers', 'save'] as const
export type EditStageId = (typeof EDIT_STAGE_IDS)[number]

/** A stage the run entered: when it started and (once over) ended, in ms since 1970. */
export interface EditStageTime { id: EditStageId; startedAt: number; endedAt: number | null }

/** What is known so far (each only once the run has found it). */
export interface EditFound {
  /** Words the local checks marked to cut before the AI plan: filler words, and retakes and restarts. */
  fillers?: number
  retakes?: number
  /** The hook the reel opens on, and how many words are cut (known once the edit is planned, or when the reel is made). */
  hook?: string
  cuts?: number
  popups?: number
  graphics?: number
  broll?: boolean
}

export interface EditProgress {
  /** When this part of the run started (the edit, then the reel). */
  startedAt: number
  renderStartedAt: number | null
  stages: EditStageTime[]
  /** "n of m" in the current stage (clip n, or piece n), from its progress line. */
  step: { n: number; of: number } | null
  /** Per-clip stages: which clip (index into sources) the step is on. */
  clip: number | null
  /** The first words heard in each clip listened to so far (newest last). */
  heard: { src: number; text: string }[]
  wordsHeard: number
  found: EditFound
  /** The reel's clip order, while it is made (combine). */
  order: number[] | null
}

export const EDIT_STAGE_LABELS: Record<EditStageId, string> = {
  ready: 'Getting your clips ready',
  listen: 'Listening',
  plan: 'Planning the edit',
  review: 'Your review',
  graphics: 'Drawing your graphics',
  cut: 'Cutting your edit',
  sound: 'Mixing the sound',
  layers: 'Adding captions and graphics',
  save: 'Saving your reel'
}

/** Which stage a progress line belongs to (null: it doesn't say; the run stays where it is). */
export function editStageOf(phase: string, detail: string, combine: boolean): EditStageId | null {
  const d = detail.trim()
  if (phase === 'transcribing') {
    if (/^(Getting your clips ready|Looking at your clips|Your clips are ready)/.test(d)) return 'ready'
    if (/^Listening/.test(d)) return 'listen'
    if (d === 'Starting') return combine ? 'ready' : 'listen'
    return null
  }
  if (phase === 'planning') return 'plan'
  if (phase === 'review') return 'review'
  if (phase === 'rendering') {
    if (/^Drawing your graphics/.test(d)) return 'graphics'
    // An edited reel made as a clip editor project: its graphics are placed, then the editor bakes them with the captions.
    if (/^(Adding b-roll|Cutting you out|Making the raw-to-edited|Adding your hook text|Adding your graphics|Adding your extras|Placing your graphics|Getting the editor ready|Ready for the editor)/.test(d)) return 'layers'
    if (/^(Cleaning up your voice|Mixing the sound|Adding the music)/.test(d)) return 'sound'
    if (/^(Getting your (clips|recording) ready|Cutting|Making it again)/.test(d)) return 'cut'
    if (/^Done$/.test(d)) return 'save'
    if (d === 'Starting') return 'cut'
    return null
  }
  return null
}

/** "(7 of 13)" in a progress line. */
export function stepOf(detail: string): { n: number; of: number } | null {
  const match = /\((\d{1,4}) of (\d{1,4})\)/.exec(detail)
  if (!match) return null
  const n = Number(match[1]), of = Number(match[2])
  return n >= 1 && of >= n ? { n, of } : null
}

export function newEditProgress(now: number): EditProgress {
  return { startedAt: now, renderStartedAt: null, stages: [], step: null, clip: null, heard: [], wordsHeard: 0, found: {}, order: null }
}

/** Into a stage (closing the one before); the same stage again only updates the step. */
export function enterStage(progress: EditProgress, stage: EditStageId, now: number): EditProgress {
  const last = progress.stages[progress.stages.length - 1]
  if (last && last.id === stage && last.endedAt === null) return progress
  const stages = progress.stages.map((item) => (item.endedAt === null ? { ...item, endedAt: now } : item))
  // A stage entered again (back to the review after a failed reel, making it again) starts over, and so do the ones after it.
  const rank = EDIT_STAGE_IDS.indexOf(stage)
  const kept = stages.filter((item) => EDIT_STAGE_IDS.indexOf(item.id) < rank)
  return { ...progress, stages: [...kept, { id: stage, startedAt: now, endedAt: null }], step: null, clip: null }
}

/** Every open stage closed (done, failed or canceled). */
export function closeStages(progress: EditProgress, now: number): EditProgress {
  return { ...progress, stages: progress.stages.map((item) => (item.endedAt === null ? { ...item, endedAt: now } : item)), step: null, clip: null }
}

/** The first words of a clip, for "Heard: …" (about a sentence). */
export function firstWords(words: string[], max = 16): string {
  const picked: string[] = []
  for (const word of words) {
    const text = word.replace(/\s+/g, ' ').trim()
    if (!text) continue
    picked.push(text)
    if (picked.length >= max || (picked.length >= 5 && /[.!?]$/.test(text))) break
  }
  return picked.join(' ').slice(0, 160)
}

const int = (value: unknown, max: number): number | undefined => (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max ? value : undefined)

/** What the engine said it found, from a progress line's info (untrusted: only known keys, bounded). */
export function parseFound(value: unknown): EditFound {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const v = value as Record<string, unknown>
  const found: EditFound = {}
  const fillers = int(v.fillers, 100000), retakes = int(v.retakes, 100000), cuts = int(v.cuts, 100000), popups = int(v.popups, 1000)
  if (fillers !== undefined) found.fillers = fillers
  if (retakes !== undefined) found.retakes = retakes
  if (cuts !== undefined) found.cuts = cuts
  if (popups !== undefined) found.popups = popups
  const graphics = int(v.graphics, 1000)
  if (graphics !== undefined) found.graphics = graphics
  if (typeof v.hook === 'string' && v.hook.trim()) found.hook = v.hook.replace(/\s+/g, ' ').trim().slice(0, 160)
  return found
}

/**
 * The stages a run of this kind goes through, in order, for the list (graphics only when it draws some before the cut:
 * an edited reel made as a clip editor project draws its graphics in the last stage, with the captions).
 */
export function editStagePlan(combine: boolean, progress: EditProgress | undefined, editor = false): EditStageId[] {
  const entered = new Set(progress?.stages.map((item) => item.id) ?? [])
  const graphics = entered.has('graphics') || (!editor && (progress?.found.graphics ?? 0) > 0)
  return [...(combine ? ['ready' as const] : []), 'listen', 'plan', 'review', ...(graphics ? ['graphics' as const] : []), 'cut', 'sound', 'layers', 'save']
}
