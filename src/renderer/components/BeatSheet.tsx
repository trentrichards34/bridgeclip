/**
 * The beat sheet (Edit my recording and Combine clips, before the reel is made): every planned on-screen moment as
 * a numbered still, with the words said, what shows and its sound. Each beat can be kept, removed, swapped for
 * another visual, have its words edited, be nudged a word earlier or later, play its few seconds ("Preview
 * motion"), or take a typed note that goes to the review's chat for that beat only. Every change goes through
 * beat-sheet.ts and touches only that beat's items, so only its still is made again.
 *
 * A still is the source frame at the beat's key moment (one FFmpeg seek in main, cached by content) with the
 * beat's graphic drawn over it by the editor's own live renderer (GraphicView) and its scene laid out around it.
 */
import { gradePreviewFilter } from '../../shared/color-grade'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Loader2, MessageSquarePlus, Pencil, Play, RotateCcw, Shuffle, Trash2, X } from 'lucide-react'
import {
  beatActions, beatNoteMessage, deriveBeats, editBeatText, moveBeat, removeBeat, restoreBeat, scopeBeatPatch, swapBeatVisual, unsaidNumber, unsaidWords,
  type Beat, type BeatText, type BeatUndo
} from '../../shared/beat-sheet'
import { BEAT_SHEET_CHOICES, type BeatSheetChoice } from '../../shared/member-prefs'
import { MAX_HOOK_TEXT_CHARS, MAX_POPUP_TEXT_CHARS, MAX_CARD_ITEMS, hookTextProblem, reelOrder, reelWordStarts, type EditDecisions, type EditImage, type EditLook, type EditPlan, type EditSource } from '../../shared/edit-recording'
import { editPatchValues, mergeEditChatSteps, type EditChatPatch } from '../../shared/edit-chat'
import { MAX_EDIT_GRAPHICS, REEL_GRAPHIC_TEMPLATES, editGraphicFrame, reelGraphicSpec, reelGraphicStyle } from '../../shared/reel-graphics'
import { fxEffect } from '../../shared/fx-catalog'
import { prefillEffect } from '../../shared/graphic-prefill'
import { STAGE_LAYOUT, SOLID_BACKDROP_COLOR, autoSceneLook } from '../../shared/scenes'
import { isHexColor } from '../../shared/headline-look'
import type { BrandIdentity } from '../../shared/remix'
import { GraphicView, fieldLabel, wordsAtPlayhead } from './ClipGraphics'
import { GraphicGallery } from './GraphicGallery'
import { wordFields } from './GraphicPreviewEditor'
import { getApi } from '../lib/ipc'
import { cn, errorMessage, localFileUrl } from '../lib/utils'
import { Button } from './ui/Button'
import { Callout } from './ui/Callout'
import { Dialog, DialogFooter } from './ui/Dialog'
import { TextArea, TextInput } from './ui/Field'
import { Segmented } from './ui/Segmented'

const STILL_WIDTH = 168
const CHOICE_LABELS: Record<BeatSheetChoice, string> = { ask: 'Ask me', always: 'Always show it', skip: 'Skip it' }

/** Frames already made this session (run id, clip, ms → image path), so a beat that comes back shows at once. */
const frameCache = new Map<string, string>()

const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`

export interface BeatSheetProps {
  runId: string
  plan: EditPlan
  decisions: EditDecisions
  look: EditLook
  brand: BrandIdentity | null
  sources: EditSource[]
  images: EditImage[]
  disabled: boolean
  /** The review's choices as the chat sees them (beat notes go to the review's chat). */
  chatState: EditDecisions
  /** The chat can be used (OpenRouter key). */
  chatReady: boolean
  choice: BeatSheetChoice
  onChoice: (choice: BeatSheetChoice) => void
  onChange: (change: (current: EditDecisions) => EditDecisions) => void
}

export function BeatSheet({ runId, plan, decisions, look, brand, sources, images, disabled, chatState, chatReady, choice, onChoice, onChange }: BeatSheetProps): React.JSX.Element {
  const beats = useMemo(() => deriveBeats(plan, decisions, { includeCaptions: look.includeCaptions }), [plan, decisions, look.includeCaptions])
  // Removed beats stay in their place (dimmed, with Bring back) while the sheet is open, so the numbers don't move.
  const [removed, setRemoved] = useState<{ beat: Beat; undo: BeatUndo }[]>([])
  const [kept, setKept] = useState<Set<string>>(new Set())
  const [frames, setFrames] = useState<Record<string, string | 'error'>>({})
  const [swapping, setSwapping] = useState<Beat | null>(null)
  const [editing, setEditing] = useState<Beat | null>(null)
  const [previewing, setPreviewing] = useState<Beat | null>(null)
  const [noting, setNoting] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [notes, setNotes] = useState<Record<string, { busy: boolean; reply?: string; error?: string; before?: EditChatPatch }>>({})
  const [error, setError] = useState<string | null>(null)

  // A removed beat that comes back another way (the chat, the details view) leaves the removed list.
  useEffect(() => { setRemoved((list) => list.some((r) => beats.some((b) => b.key === r.beat.key)) ? list.filter((r) => !beats.some((b) => b.key === r.beat.key)) : list) }, [beats])
  const shown = useMemo(() => [...beats.map((beat) => ({ beat, removed: null as BeatUndo | null })), ...removed.map((r) => ({ beat: r.beat, removed: r.undo }))]
    .sort((a, b) => a.beat.start - b.beat.start || a.beat.number - b.beat.number).map((item, n) => ({ ...item, number: n + 1 })), [beats, removed])

  // Frames: asked for as the beats need them (main makes two at a time); each card shows its still as it arrives.
  const frameKey = (frame: Beat['frame']): string => frame ? `${runId}:${frame.src}:${frame.ms}` : ''
  useEffect(() => {
    let live = true
    const wanted = [...new Set(beats.map((b) => frameKey(b.frame)).filter((k) => k && !frames[k]))]
    for (const key of wanted) {
      const cached = frameCache.get(key)
      if (cached) { setFrames((current) => ({ ...current, [key]: cached })); continue }
      const [, src, ms] = key.split(':')
      if (typeof getApi().edit.beatFrame !== 'function') continue
      void getApi().edit.beatFrame(Number(src), Number(ms)).then((path) => {
        frameCache.set(key, path)
        if (live) setFrames((current) => ({ ...current, [key]: path }))
      }).catch(() => { if (live) setFrames((current) => ({ ...current, [key]: 'error' })) })
    }
    return () => { live = false }
  }, [beats, runId])
  const ready = beats.filter((b) => b.frame && frames[frameKey(b.frame)]).length

  const media = (src: number): string | undefined => sources[src]?.proxy ?? sources[src]?.path
  const line = (beat: Beat): string => beat.words
  const style = reelGraphicStyle(look.headlineLook)

  const remove = (beat: Beat): void => {
    const { undo } = removeBeat(decisions, beat)
    onChange((current) => removeBeat(current, beat).decisions)
    setRemoved((list) => [...list.filter((r) => r.beat.key !== beat.key), { beat, undo }])
  }
  const bringBack = (beat: Beat, undo: BeatUndo): void => {
    onChange((current) => restoreBeat(current, undo))
    setRemoved((list) => list.filter((r) => r.beat.key !== beat.key))
  }
  const move = (beat: Beat, step: -1 | 1): void => {
    const moved = moveBeat(plan, decisions, beat, step)
    if (!moved) { setError(step < 0 ? 'This beat already starts on the first word it can.' : 'This beat already starts on the last word it can.'); return }
    onChange((current) => moveBeat(plan, current, beat, step)?.decisions ?? current)
  }
  const swap = (beat: Beat, template: Parameters<typeof swapBeatVisual>[2], effect?: string): void => {
    const fields = template === 'fx' ? prefillEffect(effect ?? '', [], 0, { line: line(beat) }).fields : wordsAtPlayhead(template, line(beat))
    const result = swapBeatVisual(decisions, beat, template, fields, effect)
    setSwapping(null)
    if (!result) { setError(`Your reel can have up to ${MAX_EDIT_GRAPHICS} graphics. Remove one first.`); return }
    onChange(() => result.decisions)
  }
  const sendNote = async (beat: Beat, number: number): Promise<void> => {
    const text = note.trim()
    if (!text) return
    setNotes((current) => ({ ...current, [beat.key]: { busy: true } }))
    try {
      const reply = await getApi().edit.chat(chatState, beatNoteMessage({ ...beat, number }, text))
      const steps = reply.steps.filter((step) => Object.keys(step.patch).length)
      const merged = steps.length ? mergeEditChatSteps(chatState, steps, { plan, images }) : {}
      const { patch } = scopeBeatPatch(plan, decisions, beat, merged)
      const keys = Object.keys(patch) as (keyof EditChatPatch)[]
      const before = keys.length ? editPatchValues(chatState, keys) : undefined
      if (keys.length) onChange((current) => ({ ...current, ...patch }))
      setNotes((current) => ({ ...current, [beat.key]: { busy: false, reply: keys.length ? reply.reply || 'Done.' : `${reply.reply ? `${reply.reply} ` : ''}Nothing on this beat changed.`, ...(reply.error ? { error: reply.error } : {}), ...(before ? { before } : {}) } }))
      setNote(''); setNoting(null)
    } catch (err) {
      setNotes((current) => ({ ...current, [beat.key]: { busy: false, error: errorMessage(err, 'Your note could not be sent.') } }))
    }
  }

  return <section className="mt-4 space-y-3" aria-labelledby="beat-sheet-title" data-testid="beat-sheet">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 id="beat-sheet-title" className="text-sm font-semibold text-ink">Beat sheet</h3>
        <p className="text-2xs text-ink-subtle">Every planned on-screen moment, in order. Change a beat and only that beat changes. Notes by number go to the chat for that beat only.</p>
        <p className="mt-0.5 text-2xs text-ink-muted" role="status" data-testid="beat-sheet-progress">{beats.length === 0 ? 'Nothing is planned on screen yet.'
          : ready < beats.filter((b) => b.frame).length ? `${beats.length} beat${beats.length === 1 ? '' : 's'} · stills ${ready} of ${beats.filter((b) => b.frame).length} ready`
            : `${beats.length} beat${beats.length === 1 ? '' : 's'} · ${kept.size ? `${[...kept].filter((k) => beats.some((b) => b.key === k)).length} kept · ` : ''}stills ready`}</p>
      </div>
      <div className="flex items-center gap-2 text-2xs text-ink-muted">Before each reel
        <Segmented size="sm" label="Before each reel" value={choice} onChange={onChoice} options={BEAT_SHEET_CHOICES.map((value) => ({ value, label: CHOICE_LABELS[value] }))} />
      </div>
    </div>
    {look.broll && <p className="text-2xs text-ink-subtle">B-roll shots are picked while your reel is made, so they aren’t on the sheet.</p>}
    {error && <Callout tone="warning" onDismiss={() => setError(null)}>{error}</Callout>}

    <ol className="grid grid-cols-[repeat(auto-fill,minmax(188px,1fr))] gap-3" aria-label="Beats">
      {shown.map(({ beat, removed: undo, number }) => {
        const actions = beatActions(beat)
        const frame = beat.frame ? frames[frameKey(beat.frame)] : undefined
        const state = notes[beat.key]
        const isKept = kept.has(beat.key)
        return <li key={`${beat.key}${undo ? ':removed' : ''}`} aria-label={`Beat ${number}`} data-testid="beat-card" data-beat={beat.key} data-hash={beat.hash}
          className={cn('glass-tile flex min-w-0 flex-col gap-2 rounded-2xl p-2', undo && 'opacity-55', isKept && !undo && 'ring-1 ring-success/50')}>
          <div className="relative mx-auto" style={{ width: STILL_WIDTH }}>
            <BeatStill beat={beat} frame={frame === 'error' ? null : frame ?? null} loading={!frame && Boolean(beat.frame)} look={look} brand={brand} images={images} width={STILL_WIDTH} />
            <span className="absolute bottom-1.5 left-1.5 rounded-md bg-tool px-1.5 py-px font-mono text-[11px] font-semibold text-canvas" aria-hidden>{number}</span>
            <span className="absolute bottom-1.5 right-1.5 rounded bg-canvas/80 px-1.5 py-px font-mono text-[9px] tabular text-ink">{clock(beat.start)}–{clock(beat.end)}</span>
            {undo && <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 bg-canvas/85 py-1 text-center text-xs font-semibold text-ink">Removed</span>}
          </div>
          <div className="min-w-0 space-y-1 px-0.5">
            <p className="text-xs font-medium leading-snug text-ink" data-testid="beat-shown">{beat.shown}</p>
            {beat.words && <p className="text-2xs leading-snug text-ink-muted">“{beat.words}”</p>}
            <p className="text-[10px] text-ink-subtle">{beat.sound ? `Sound: ${beat.sound}` : 'No sound'}{beat.scene === 'stage' ? ' · Stage' : beat.scene === 'visual' ? ' · Full-screen visual' : ''}</p>
            {beat.problem && !undo && <p className="text-2xs text-warning" role="note">{beat.problem}</p>}
          </div>
          {undo ? <Button size="sm" variant="secondary" icon={<RotateCcw className="h-3.5 w-3.5" />} disabled={disabled} onClick={() => bringBack(beat, undo)}>Bring back</Button> : <>
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant={isKept ? 'primary' : 'secondary'} icon={<Check className="h-3.5 w-3.5" />} aria-pressed={isKept} aria-label={`Keep beat ${number}`} disabled={disabled}
                onClick={() => setKept((set) => { const next = new Set(set); if (next.has(beat.key)) next.delete(beat.key); else next.add(beat.key); return next })}>{isKept ? 'Kept' : 'Keep'}</Button>
              <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} aria-label={`Remove beat ${number}`} disabled={disabled} onClick={() => remove(beat)}>Remove</Button>
              {actions.swap && <Button size="sm" variant="ghost" icon={<Shuffle className="h-3.5 w-3.5" />} aria-label={`Swap the visual of beat ${number}`} disabled={disabled} onClick={() => setSwapping(beat)}>Swap visual</Button>}
              {actions.text && <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} aria-label={`Edit the text of beat ${number}`} disabled={disabled} onClick={() => setEditing(beat)}>Edit text</Button>}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {actions.move && <>
                <Button size="sm" variant="ghost" iconOnly icon={<ArrowLeft className="h-3.5 w-3.5" />} aria-label={`Move beat ${number} a word earlier`} tooltip="A word earlier" disabled={disabled} onClick={() => move(beat, -1)} />
                <Button size="sm" variant="ghost" iconOnly icon={<ArrowRight className="h-3.5 w-3.5" />} aria-label={`Move beat ${number} a word later`} tooltip="A word later" disabled={disabled} onClick={() => move(beat, 1)} />
              </>}
              <Button size="sm" variant="ghost" icon={<Play className="h-3.5 w-3.5" />} aria-label={`Preview motion of beat ${number}`} disabled={!beat.frame} onClick={() => setPreviewing(beat)}>Preview motion</Button>
              <Button size="sm" variant="ghost" icon={<MessageSquarePlus className="h-3.5 w-3.5" />} aria-label={`Add a note to beat ${number}`} aria-expanded={noting === beat.key}
                disabled={disabled || !chatReady} tooltip={chatReady ? 'Say what to change, like “make it smaller” or “use a chart here”.' : 'Add your OpenRouter key to send notes.'}
                onClick={() => { setNoting(noting === beat.key ? null : beat.key); setNote('') }}>Note</Button>
            </div>
            {noting === beat.key && <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); void sendNote(beat, number) }}>
              <TextArea rows={2} aria-label={`Note for beat ${number}`} placeholder="Like “use a chart here”" value={note} maxLength={400} autoFocus onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendNote(beat, number) } }} />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-ink-subtle">Uses your OpenRouter credit.</span>
                <Button type="submit" size="sm" variant="primary" loading={state?.busy} disabled={!note.trim() || state?.busy}>Send note</Button>
              </div>
            </form>}
            {state?.busy && noting !== beat.key && <p className="flex items-center gap-1 text-2xs text-ink-muted"><Loader2 className="h-3 w-3 animate-spin" aria-hidden />Working on your note…</p>}
            {state && !state.busy && (state.reply || state.error) && <div className="rounded-lg bg-white/[0.04] px-2 py-1.5 text-2xs text-ink-muted" data-testid="beat-note-reply">
              {state.reply && <p>{state.reply}</p>}
              {state.error && <p className="text-danger">{state.error}</p>}
              {state.before && <Button size="sm" variant="ghost" className="mt-1" onClick={() => { const before = state.before!; onChange((current) => ({ ...current, ...before })); setNotes((current) => ({ ...current, [beat.key]: { busy: false, reply: 'Undone.' } })) }}>Undo</Button>}
            </div>}
          </>}
        </li>
      })}
    </ol>

    {swapping && <GraphicGallery title="Swap the visual" templates={REEL_GRAPHIC_TEMPLATES} where={`on beat ${shown.find((s) => s.beat.key === swapping.key)?.number ?? swapping.number}, as you say “${swapping.words.split(' ').slice(0, 6).join(' ')}”`}
      style={style} full={false} limitNote="" prefill={(template) => wordsAtPlayhead(template, line(swapping))}
      prefillEffect={(effect) => prefillEffect(effect, [], 0, { line: line(swapping) }).fields}
      onPick={(template, pick) => swap(swapping, template, template === 'fx' ? pick : undefined)} onClose={() => setSwapping(null)} />}
    {editing && <BeatTextDialog beat={editing} number={shown.find((s) => s.beat.key === editing.key)?.number ?? editing.number} plan={plan} decisions={decisions}
      onSave={(change) => { onChange((current) => editBeatText(current, editing, change)); setEditing(null) }} onClose={() => setEditing(null)} />}
    {previewing && <BeatPreview beat={previewing} number={shown.find((s) => s.beat.key === previewing.key)?.number ?? previewing.number} plan={plan} decisions={decisions} look={look} brand={brand}
      images={images} media={media} onClose={() => setPreviewing(null)} />}
  </section>
}

/** A scene's backdrop (engine stage_scenes): light gray, the brand grid, or the solid color behind a diagram. */
function backdrop(scene: Beat['scene'], brand: BrandIdentity | null): React.CSSProperties {
  const color = brand?.look?.color && isHexColor(brand.look.color) ? brand.look.color : null
  if (scene === 'visual') return { background: color ?? SOLID_BACKDROP_COLOR }
  return autoSceneLook(color).backdrop === 'grid'
    ? { background: `linear-gradient(rgb(255 255 255 / 0.35) 1px, transparent 1px) 0 0 / 12px 12px, linear-gradient(90deg, rgb(255 255 255 / 0.35) 1px, transparent 1px) 0 0 / 12px 12px, linear-gradient(180deg, #E6E0FF, ${color})` }
    : { background: '#ECEEF2' }
}

/**
 * One beat's still (or, with `video`, its moving preview): the frame laid out in the beat's scene, its graphic (or
 * image) at `time` ms into it (default: settled), the hook text over the opening and the captions' words.
 */
export function BeatStill({ beat, frame, loading, look, brand, images, width, time, video }: {
  beat: Beat; frame: string | null; loading?: boolean; look: EditLook; brand: BrandIdentity | null; images: EditImage[]; width: number
  time?: number | null; video?: React.ReactNode
}): React.JSX.Element {
  const height = width * 16 / 9
  const graphicFrame = useMemo(() => editGraphicFrame(beat.hookText, look), [beat.hookText, look])
  const spec = useMemo(() => beat.visual?.type === 'graphic' ? reelGraphicSpec(beat.visual.graphic, graphicFrame, beat.visual.graphic.duration_ms, look.headlineLook) : null, [beat.visual, graphicFrame, look.headlineLook])
  const footage = video ?? (frame ? <img src={localFileUrl(frame)} alt="" draggable={false} className="h-full w-full object-cover" data-testid="beat-frame" /> : null)
  // The color grade previews on the footage only (the graphics and text over it keep their colors).
  const grade = gradePreviewFilter(look.grade)
  const picture = footage && grade ? <div className="h-full w-full" style={{ filter: grade }}>{footage}</div> : footage
  const image = beat.visual?.type === 'image' ? images.find((item) => item.id === (beat.visual as { image: string }).image) : undefined
  const arch = autoSceneLook(brand?.look?.color).card === 'arch'
  const at = time === undefined ? (beat.visual?.type === 'graphic' ? beat.visual.atMs : null) : time
  return <div className="relative overflow-hidden rounded-xl bg-black" style={{ width, height }} data-testid="beat-still" data-scene={beat.scene}>
    {beat.scene === 'face' ? <div className="absolute inset-0">{picture}</div> : <div className="absolute inset-0" style={backdrop(beat.scene, brand)}>
      {beat.scene === 'stage' && <div className="absolute overflow-hidden bg-black" style={arch
        ? { left: 0, right: 0, bottom: 0, height: `${STAGE_LAYOUT.cardHeight * 100}%`, borderRadius: `${STAGE_LAYOUT.archRadius * width}px ${STAGE_LAYOUT.archRadius * width}px 0 0` }
        : { left: `${STAGE_LAYOUT.cardSide * 100}%`, right: `${STAGE_LAYOUT.cardSide * 100}%`, bottom: `${STAGE_LAYOUT.cardBottom * 100}%`, height: `${STAGE_LAYOUT.cardHeight * 100}%`, borderRadius: STAGE_LAYOUT.cardRadius * width }}>{picture}</div>}
    </div>}
    {loading && !frame && !video && <div className="absolute inset-0 flex items-center justify-center bg-white/[0.04]" aria-label="Making the still"><Loader2 className="h-4 w-4 animate-spin text-ink-subtle" aria-hidden /></div>}
    {spec && at !== null && at >= 0 && <div className="pointer-events-none absolute inset-0" aria-hidden><GraphicView spec={spec} time={at} width={width} /></div>}
    {image && at !== null && at >= 0 && <img src={localFileUrl(image.path)} alt="" className="absolute left-1/2 top-1/2 w-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg shadow-lg" />}
    {beat.hookText && look.headlineLook.look !== 'none' && <p className="absolute inset-x-[7%] top-[5%] text-center font-display text-[11px] font-bold leading-tight text-white [text-shadow:0_1px_4px_rgb(0_0_0/0.8)]"
      style={look.headlineLook.look === 'brand' && isHexColor(look.headlineLook.color) ? { color: look.headlineLook.color } : undefined}>{beat.hookText}</p>}
    {beat.caption && <p className="absolute inset-x-[8%] text-center text-[10px] font-extrabold uppercase leading-tight text-white [text-shadow:0_1px_3px_rgb(0_0_0/0.9)]" style={{ top: `${(beat.scene === 'visual' ? 0.82 : 0.75) * 100}%` }}>{beat.caption}</p>}
  </div>
}

/** "Preview motion": just this beat's few seconds, played from the recording with its graphic drawn live (no render). */
function BeatPreview({ beat, number, plan, decisions, look, brand, images, media, onClose }: {
  beat: Beat; number: number; plan: EditPlan; decisions: EditDecisions; look: EditLook; brand: BrandIdentity | null; images: EditImage[]
  media: (src: number) => string | undefined; onClose: () => void
}): React.JSX.Element {
  const video = useRef<HTMLVideoElement>(null)
  const [time, setTime] = useState<number | null>(-1)
  const [playing, setPlaying] = useState(false)
  const [failed, setFailed] = useState(false)
  // The kept words in the beat (and a little after), as runs of one clip played one after another.
  const segments = useMemo(() => {
    const starts = reelWordStarts(plan, decisions)
    const words = reelOrder(plan, decisions).filter((i) => { const s = starts.get(i)!; return s >= beat.start - 0.25 && s < beat.end + 0.4 })
    const out: { src: number; fromMs: number; toMs: number; at: number }[] = []
    for (const i of words) {
      const w = plan.words[i], last = out[out.length - 1]
      if (last && last.src === w.src && Math.abs(w.startMs - last.toMs) < 700 && w.startMs >= last.toMs - 5) last.toMs = w.endMs
      else out.push({ src: w.src, fromMs: w.startMs, toMs: w.endMs, at: starts.get(i)! })
    }
    return out
  }, [plan, decisions, beat.start, beat.end])
  const visualStart = beat.parts.find((p) => p.ref === beat.key)?.start ?? beat.start
  const stop = useRef<() => void>(() => undefined)
  const play = (): void => {
    const el = video.current
    if (!el || !segments.length) return
    stop.current()
    let k = 0, frame = 0
    const load = (seg: typeof segments[number]): void => {
      const url = media(seg.src)
      const want = url ? localFileUrl(url) : ''
      if (el.getAttribute('data-src') !== want) { el.setAttribute('data-src', want); el.src = want }
      el.currentTime = seg.fromMs / 1000
      void el.play().catch(() => setFailed(true))
    }
    const tick = (): void => {
      const seg = segments[k]
      const ms = el.currentTime * 1000
      if (ms >= seg.toMs) {
        k++
        if (k >= segments.length) { el.pause(); setPlaying(false); setTime(null); return }
        load(segments[k])
      } else if (ms >= seg.fromMs - 50) setTime(Math.round((seg.at + (ms - seg.fromMs) / 1000 - visualStart) * 1000))
      frame = requestAnimationFrame(tick)
    }
    setPlaying(true); setFailed(false)
    load(segments[0])
    frame = requestAnimationFrame(tick)
    stop.current = () => { cancelAnimationFrame(frame); el.pause(); setPlaying(false) }
  }
  useEffect(() => { const id = requestAnimationFrame(play); return () => { cancelAnimationFrame(id); stop.current() } }, [])
  const vid = <video ref={video} playsInline preload="auto" className="h-full w-full object-cover" aria-label={`Beat ${number} preview`} onError={() => setFailed(true)} />
  return <Dialog aria-label={`Beat ${number}: preview motion`} panelClassName="max-w-[380px]" onBackdropMouseDown={onClose}
    onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }}>
    <div className="flex items-start justify-between gap-2 px-4 pt-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-ink">Beat {number}: preview motion</h2>
        <p className="text-2xs text-ink-subtle">{beat.shown}. Played from your recording with the graphic drawn live. Sound effects and music aren’t in this preview.</p>
      </div>
      <Button size="sm" variant="ghost" iconOnly icon={<X className="h-4 w-4" />} aria-label="Close" onClick={onClose} />
    </div>
    <div className="flex justify-center p-4">
      <BeatStill beat={beat} frame={null} look={look} brand={brand} images={images} width={270} time={time} video={vid} />
    </div>
    {failed && <p className="px-4 pb-2 text-2xs text-danger">This recording can’t play here. The still shows how the beat looks.</p>}
    <DialogFooter>
      <Button size="sm" variant="secondary" icon={<Play className="h-3.5 w-3.5" />} disabled={playing} onClick={play}>Play again</Button>
      <Button size="sm" variant="primary" onClick={onClose}>Done</Button>
    </DialogFooter>
  </Dialog>
}

/** "Edit text": the beat's words (a graphic's word fields, a pop-up's text, a card's lines, the hook text). Numbers must be ones you say. */
function BeatTextDialog({ beat, number, plan, decisions, onSave, onClose }: {
  beat: Beat; number: number; plan: EditPlan; decisions: EditDecisions; onSave: (change: BeatText) => void; onClose: () => void
}): React.JSX.Element {
  const graphic = beat.key.startsWith('g:') ? (decisions.graphics ?? []).find((g) => g.id === beat.key.slice(2)) ?? null : null
  const popupId = beat.key.startsWith('p:') ? Number(beat.key.slice(2)) : null
  const popup = popupId === null ? null : plan.popups.find((p) => p.id === popupId) ?? null
  const choice = popupId === null ? null : decisions.popups.find((p) => p.id === popupId) ?? null
  const card = popup?.kind === 'card' ? choice?.card ?? popup.card ?? null : null
  // The fields shown: a graphic's word fields (an effect's text, number and list fields), else one or two boxes.
  const fieldList: { key: string; label: string; multiline: boolean; max: number }[] = graphic
    ? graphic.template === 'fx'
      ? (fxEffect(graphic.fields.effect)?.fields ?? []).filter((f) => f.kind !== 'choice').map((f) => ({ key: f.key, label: f.label, multiline: f.kind === 'list', max: f.kind === 'list' ? 400 : f.max ?? 80 }))
      : wordFields(graphic.template).map((key) => ({ key, label: fieldLabel(graphic.template, key), multiline: key === 'items', max: key === 'items' ? 800 : 160 }))
    : beat.key === 'hook' ? [{ key: 'hook', label: 'Hook text', multiline: false, max: MAX_HOOK_TEXT_CHARS }]
      : card ? [{ key: 'title', label: 'Title', multiline: false, max: 48 }, { key: 'items', label: `Lines (one per line, up to ${MAX_CARD_ITEMS})`, multiline: true, max: 260 }]
        : popup ? [{ key: 'text', label: 'Pop-up text', multiline: false, max: MAX_POPUP_TEXT_CHARS }] : []
  const initial = (): Record<string, string> => {
    if (graphic) return Object.fromEntries(fieldList.map((f) => [f.key, graphic.fields[f.key] ?? '']))
    if (beat.key === 'hook') return { hook: decisions.hookText }
    if (card) return { title: card.title, items: card.items.join('\n') }
    if (popup) return { text: choice?.text ?? popup.text }
    return {}
  }
  const [values, setValues] = useState<Record<string, string>>(initial)
  const texts = Object.values(values)
  const numberProblem = unsaidNumber(plan, decisions, texts)
  const hookProblem = beat.key === 'hook' ? hookTextProblem(values.hook ?? '') : null
  const unsaid = unsaidWords(plan, decisions, texts)
  const problem = numberProblem ?? hookProblem
  const save = (): void => {
    if (problem) return
    if (graphic) onSave({ fields: values })
    else if (beat.key === 'hook') onSave({ hookText: values.hook ?? '' })
    else if (card) onSave({ card: { type: card.type, title: (values.title ?? '').trim(), items: (values.items ?? '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, MAX_CARD_ITEMS) } })
    else if (popup) onSave({ text: values.text ?? '' })
  }
  return <Dialog aria-label={`Beat ${number}: edit text`} panelClassName="max-w-[440px]" onBackdropMouseDown={onClose}
    onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }}>
    <form onSubmit={(e) => { e.preventDefault(); save() }}>
      <div className="space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">Beat {number}: edit text</h2>
          <p className="text-2xs text-ink-subtle">You say: “{beat.words}”. Use your own words; numbers must be ones you say.</p>
        </div>
        {fieldList.map((f) => <label key={f.key} className="block space-y-1 text-2xs text-ink-muted">{f.label}
          {f.multiline
            ? <TextArea rows={3} value={values[f.key] ?? ''} maxLength={f.max} aria-label={f.label} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
            : <TextInput value={values[f.key] ?? ''} maxLength={f.max} aria-label={f.label} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />}
        </label>)}
        {problem && <p className="text-2xs text-danger" role="alert">{problem}</p>}
        {!problem && unsaid.length > 0 && <p className="text-2xs text-ink-subtle">Not in what you say: {unsaid.map((w) => `“${w}”`).join(', ')}. That’s fine for your own words.</p>}
      </div>
      <DialogFooter>
        <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" size="sm" variant="primary" disabled={Boolean(problem)}>Save</Button>
      </DialogFooter>
    </form>
  </Dialog>
}
