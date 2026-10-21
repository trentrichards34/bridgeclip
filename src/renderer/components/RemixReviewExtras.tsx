/**
 * Graphics and Chat on the review of an on-camera remix (Their clip then me,
 * React then my thoughts, Pause & react, Moment + my take). Shared by the
 * three review screens: each keeps the hook text, caption and graphics of a
 * take in its own state and hands them in here with their setters, plus a
 * refresh for what main holds (the part of their video, the take, the layout).
 */
import { useMemo, useState } from 'react'
import { MessageSquare, Scissors } from 'lucide-react'
import { newGraphic, type EditorGraphic, type GraphicTemplateId } from '../../shared/motion-graphics'
import { MIN_TAKE_PART_MS } from '../../shared/remix-chat'
import { TAKE_GRAPHIC_FROM_MS, fitRemixGraphic, remixGraphicFrame, isRemixGraphicFormat } from '../../shared/reel-graphics'
import { REMIX_CHAT_POINT_SUGGESTIONS, mergeRemixChatSteps, remixChatIntro, remixChatSuggestions, remixPartName, parseRemixChatSteps, type RemixChatAction, type RemixChatPatch, type RemixChatStep } from '../../shared/remix-chat'
import type { RemixDraft, RemixRecordings, RemixStatus } from '../../shared/remix'
import type { RemixAsked } from '../../shared/edit-log'
import { TrimControl } from './PauseReactReview'
import { getApi } from '../lib/ipc'
import { errorMessage } from '../lib/utils'
import { ChatPanel, type ChatApplyOutcome } from './ChatPanel'
import { PointPad } from './ChatPoints'
import { ReelGraphics, type ReelGraphicItem, type ReelGraphicPatch } from './ReelGraphics'
import { Button } from './ui/Button'

/** What a take's review holds in the page: the hook text, caption and graphics. */
export interface TakeText { headline: string; postCaption: string; graphics: EditorGraphic[] }

const clock = (ms: number): string => { const s = Math.max(0, ms) / 1000; return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}` }

/** Graphics on the member's part of a take. `partMs`: the take as recorded (Pause & react: the finished video), null before it's recorded. */
export function RemixGraphicsSection({ status, draft, text, onGraphics, partMs, recordings, banner, disabled, step }: {
  status: RemixStatus
  draft: RemixDraft
  text: TakeText
  onGraphics: (change: (list: EditorGraphic[]) => EditorGraphic[]) => void
  partMs: number | null
  recordings: RemixRecordings
  /** React, then my thoughts: the comment banner sits at the top of part 2. */
  banner: boolean
  disabled: boolean
  step?: number
}): React.JSX.Element | null {
  const context = status.graphics
  const frame = useMemo(() => context ? remixGraphicFrame(context, text.headline, banner) : null, [context, text.headline, banner])
  if (!context || !frame || !isRemixGraphicFormat(draft.format)) return null
  const format = draft.format
  const pause = format === 'pause_react'
  const trim = recordings[draft.id]?.reaction?.trim ?? null
  const total = partMs ?? 0
  const blocked: { start: number; end: number; label: string }[] = []
  if (!pause) blocked.push({ start: 0, end: TAKE_GRAPHIC_FROM_MS / 1000, label: 'The “My take” label shows here' })
  if (trim) {
    if (trim.startMs > 0) blocked.push({ start: 0, end: trim.startMs / 1000, label: 'Not used: trimmed from your take' })
    if (trim.endMs < total) blocked.push({ start: trim.endMs / 1000, end: total / 1000, label: 'Not used: trimmed from your take' })
  }
  const outside = (g: EditorGraphic): string | null => trim && (g.at_ms < trim.startMs || g.at_ms >= trim.endMs - 400) ? 'It’s in a part of your take that isn’t used, so it won’t show. Move it.' : null
  const items: ReelGraphicItem[] = text.graphics.map(({ at_ms, ...rest }) => ({ ...rest, at: at_ms / 1000, where: `at ${clock(at_ms)}`, problem: outside({ ...rest, at_ms }) }))
  const add = (template: GraphicTemplateId, at: number): string | null => {
    if (!partMs) return null
    const g = fitRemixGraphic(newGraphic(template, Math.round(at * 1000), { taken: text.graphics.map((x) => x.id) }), format, partMs)
    onGraphics((list) => [...list, g].sort((a, b) => a.at_ms - b.at_ms))
    return g.id
  }
  const patch = (id: string, change: ReelGraphicPatch): void => {
    if (!partMs) return
    onGraphics((list) => list.map((g) => {
      if (g.id !== id) return g
      const fields = { ...g.fields }
      for (const [key, value] of Object.entries(change.fields ?? {})) fields[key] = value
      if (change.fields?.color === '') delete fields.color
      return fitRemixGraphic({ ...g, ...(change.at !== undefined ? { at_ms: Math.round(change.at * 1000) } : {}), ...(change.duration_ms !== undefined ? { duration_ms: change.duration_ms } : {}),
        ...(change.placement ? { placement: change.placement } : {}), fields }, format, partMs)
    }).sort((a, b) => a.at_ms - b.at_ms))
  }
  const react = format === 'react_thoughts'
  // The format's own name for the member's part ("Part 2 · Your thoughts" in React, then my thoughts).
  const part = remixPartName(format)
  const over = react ? `“${part}”` : part
  return <section className="glass-tile space-y-3 rounded-2xl p-4" aria-label="Graphics on your part">
    <ReelGraphics label={step ? `${step} · Graphics` : 'Graphics'}
      intro={`Animated cards over ${over}: a stat that counts up, a title, a list and more. They stay clear of ${pause ? 'their video, ' : ''}your hook text and captions${format === 'moment_take' && context.momentPip ? ' and the moment’s box' : ''}. One that would cover a proof screenshot is left out.`}
      items={items} totalSeconds={total / 1000} blocked={blocked} frame={frame} look={context.headlineLook} disabled={disabled}
      emptyNote={partMs ? null : pause ? 'Record your reaction first: graphics go on your part.' : react ? `Record ${part} first: graphics go on it.` : 'Record your take first: graphics go on your part.'}
      onAdd={add} onPatch={patch} onRemove={(id) => onGraphics((list) => list.filter((g) => g.id !== id))}
      cursorLabel={(at) => `at ${clock(Math.max(pause ? 0 : TAKE_GRAPHIC_FROM_MS, at * 1000))} of ${part}`} />
  </section>
}

/**
 * Their clip then me / Moment + my take: Start and End for the member's own take (like their clip's trim), so only
 * that part of it is used. Free; the hook text and caption stay as written.
 */
export function TakeTrimControl({ draft, recordings, disabled, onRecordings, onError }: {
  draft: RemixDraft; recordings: RemixRecordings; disabled: boolean; onRecordings: (list: RemixRecordings) => void; onError: (message: string | null) => void
}): React.JSX.Element | null {
  const [saving, setSaving] = useState(false)
  const take = recordings[draft.id]?.reaction
  if (!take?.path || !take.seconds) return null
  const total = Math.round(take.seconds * 1000)
  const startMs = take.trim?.startMs ?? 0, endMs = take.trim?.endMs ?? total
  const save = (a: number, b: number): void => {
    setSaving(true); onError(null)
    const whole = a <= 50 && b >= total - 50
    getApi().remix.takeTrim(draft.id, whole ? null : a, whole ? null : b).then(onRecordings, (e) => onError(errorMessage(e, 'That part of your take could not be used.'))).finally(() => setSaving(false))
  }
  return <div data-testid="take-trim-control">
    <TrimControl key={`${take.path}-${startMs}-${endMs}`} source={take.path} startMs={startMs} endMs={endMs} disabled={disabled} saving={saving} uploaded={take.uploaded}
      onTrim={save} label="Your take" minSeconds={MIN_TAKE_PART_MS / 1000} durationSeconds={take.seconds}
      note="Only this part of your take is used. Graphics outside it don’t show." />
  </div>
}

/** Their clip then me / Moment + my take: the part of the take used, when it's trimmed (from the chat or the controls). */
export function TakeTrimNote({ draft, recordings, disabled, onRecordings, onError }: {
  draft: RemixDraft; recordings: RemixRecordings; disabled: boolean; onRecordings: (list: RemixRecordings) => void; onError: (message: string | null) => void
}): React.JSX.Element | null {
  const take = recordings[draft.id]?.reaction
  if (!take?.trim) return null
  return <p className="flex flex-wrap items-center gap-2 text-2xs text-ink-muted" data-testid="take-trim">
    <Scissors className="h-3.5 w-3.5" aria-hidden />Uses {clock(take.trim.startMs)}–{clock(take.trim.endMs)} of your take ({((take.trim.endMs - take.trim.startMs) / 1000).toFixed(1)}s of {take.seconds.toFixed(1)}s).
    <Button size="sm" variant="ghost" disabled={disabled} onClick={() => { getApi().remix.takeTrim(draft.id, null, null).then(onRecordings, (e) => onError(errorMessage(e))) }}>Use all of it</Button>
  </p>
}

interface RemixApplied { before: RemixChatPatch; undo: RemixChatAction[] }

/** The Chat panel for one take: changes the page's text and graphics, and calls main for the rest. */
export function RemixChatSection({ runId, draft, text, onText, afterMain, disabledReason, label, video, suggestions, onAsked }: {
  runId: string
  draft: RemixDraft
  text: TakeText
  onText: (patch: Partial<TakeText>) => void
  /** Reload what main holds after a change there (recordings, layout, the pause view). */
  afterMain: () => Promise<void>
  disabledReason: string | null
  label?: string
  /** The member's take: a still of it to point on (none yet: an empty frame). */
  video?: string | null
  /** The chips (default: the format's own, see remixChatSuggestions). */
  suggestions?: readonly string[]
  /** What a kept answer set (the hook text, caption, their part, the take's trim), for "What changed". */
  onAsked?: (asked: RemixAsked) => void
}): React.JSX.Element {
  const format = isRemixGraphicFormat(draft.format) ? draft.format : 'clip_then_me'
  const api = getApi().remix
  const run = async (action: RemixChatAction): Promise<void> => {
    if (action.kind === 'their_clip') {
      if (draft.format === 'moment_take') await api.momentBounds(draft.id, action.startMs, action.endMs)
      else await api.trim(draft.id, action.startMs, action.endMs)
    } else if (action.kind === 'take_trim') await api.takeTrim(draft.id, action.startMs, action.endMs)
    else await api.setLayout(action.patch)
  }
  const apply = async (steps: RemixChatStep[]): Promise<ChatApplyOutcome<RemixApplied>> => {
    const edits = steps.filter((s) => Object.keys(s.patch).length || s.action)
    if (!edits.length) return { applied: null, length: null }
    let merged: ReturnType<typeof mergeRemixChatSteps>
    try { merged = mergeRemixChatSteps(edits) } catch (error) { return { error: (error as Error).message } }
    const before: RemixChatPatch = {}
    for (const key of Object.keys(merged.patch) as (keyof RemixChatPatch)[]) (before as Record<string, unknown>)[key] = structuredClone(text[key])
    if (Object.keys(merged.patch).length) onText(merged.patch)
    const done: RemixChatAction[] = []
    try {
      for (const action of merged.actions) { await run(action); done.push(action) }
    } catch (error) {
      await afterMain().catch(() => undefined)
      const undo = merged.undo.slice(merged.undo.length - done.length)
      return done.length || Object.keys(merged.patch).length ? { applied: { before, undo }, length: `Not everything could be changed: ${errorMessage(error)}` } : { error: errorMessage(error) }
    }
    if (merged.actions.length) await afterMain().catch(() => undefined)
    if (onAsked) {
      const asked: RemixAsked = {}
      if (merged.patch.headline !== undefined) asked.headline = merged.patch.headline
      if (merged.patch.postCaption !== undefined) asked.postCaption = merged.patch.postCaption
      for (const action of merged.actions) {
        if (action.kind === 'their_clip') asked.theirClip = { startMs: action.startMs, endMs: action.endMs }
        if (action.kind === 'take_trim' && action.startMs !== null && action.endMs !== null) asked.takeTrim = { startMs: action.startMs, endMs: action.endMs }
      }
      if (Object.keys(asked).length) onAsked(asked)
    }
    return { applied: { before, undo: merged.undo }, length: null }
  }
  const undo = async (applied: RemixApplied): Promise<string | null> => {
    if (Object.keys(applied.before).length) onText(applied.before)
    try { for (const action of applied.undo) await run(action) } catch (error) { await afterMain().catch(() => undefined); return `That couldn’t be undone: ${errorMessage(error)}` }
    if (applied.undo.length) await afterMain().catch(() => undefined)
    return null
  }
  return <section className="glass-tile space-y-3 rounded-2xl p-4" aria-labelledby={`remix-chat-${draft.id}`}>
    <h3 id={`remix-chat-${draft.id}`} className="flex items-center gap-1.5 text-sm font-medium text-ink"><MessageSquare className="h-4 w-4" aria-hidden />{label ?? 'Chat'}</h3>
    <ChatPanel<RemixChatStep, RemixApplied>
      variant="review" threadKey={`remix\n${runId}\n${draft.id}`} label="Chat about your video"
      intro={remixChatIntro(format)}
      placeholder="Ask for a change to this video" suggestions={suggestions ?? remixChatSuggestions(format)}
      disabledReason={disabledReason}
      loadInfo={typeof api?.chatInfo === 'function' ? () => api.chatInfo() : undefined}
      ask={(message, points) => api.chat({ draftId: draft.id, headline: text.headline, postCaption: text.postCaption, graphics: text.graphics }, message, points)}
      point={{ suggestions: REMIX_CHAT_POINT_SUGGESTIONS, pad: <PointPad thread={`remix\n${runId}\n${draft.id}`} video={video} /> }}
      parseSteps={parseRemixChatSteps} isEdit={(s) => Object.keys(s.patch).length > 0 || Boolean(s.action)}
      apply={apply} undo={undo}
      onReset={() => { void api?.chatReset?.(draft.id).catch(() => {}) }}
      clearTooltip="Start a new chat about this video. Your changes stay." />
  </section>
}
