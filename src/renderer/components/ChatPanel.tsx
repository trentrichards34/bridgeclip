/**
 * The chat panel shared by the clip editor's Chat tab, Edit my recording's
 * review and Remix's review: the conversation, a change card per answer (what
 * changed, Keep or Undo), suggestion chips and the message box. The place
 * supplies how to ask (a paid IPC call), how to apply the checked steps through
 * its own setters, and how to undo them.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Loader2, MapPin, MessageSquare, Play, RotateCcw, Send, Undo2 } from 'lucide-react'
import { cn, errorMessage } from '../lib/utils'
import { Button } from './ui/Button'
import { CHAT_MAX_MESSAGE_CHARS, type ChatInfo, type ChatStepBase } from '../../shared/chat-core'
import { pointLabel, type ChatPoint } from '../../shared/chat-point'
import { useChatPointsStore, useThreadPoints } from '../store/use-chat-points-store'
import { PointButton, PointChips } from './ChatPoints'

export type ChatApplyOutcome<Applied> = { applied: Applied | null; length: string | null } | { error: string }

interface ChatCard<Applied> {
  lines: string[]
  /** "Clip is now 37.7s." */
  length: string | null
  state: 'open' | 'kept' | 'undone'
  applied: Applied | null
  /** A moment the answer played, to play again. */
  replay?: { at: number; seconds: number }
}
interface ChatEntry<Applied> { id: number; role: 'member' | 'assistant' | 'error'; text: string; card?: ChatCard<Applied>; pins?: string[] }

// Each thread's conversation for this app session (main keeps the model's side the same way).
const threads = new Map<string, ChatEntry<unknown>[]>()
let nextId = 1

export interface ChatPanelProps<Step extends ChatStepBase, Applied> {
  /** One conversation per key (a clip, a review, a take). */
  threadKey: string
  /** The region's name ("Chat about this clip"). */
  label: string
  intro: string
  placeholder: string
  suggestions: readonly string[]
  /** 'editor': the clip editor's inspector column; 'review': a card on a review screen. */
  variant?: 'editor' | 'review'
  /** Why editing is off right now (busy, discarded), or null. */
  disabledReason: string | null
  loadInfo: (() => Promise<ChatInfo>) | undefined
  /** `points`: the pins the member put on the preview for this message (cleared once it is sent). */
  ask: (message: string, points: ChatPoint[]) => Promise<{ reply: string; steps: unknown; error?: string }>
  parseSteps: (value: unknown) => Step[]
  /** Steps that change something (others, like play, only show). */
  isEdit: (step: Step) => boolean
  /** Applies the checked steps through the place's setters (some places call main, so it may be async). */
  apply: (steps: Step[]) => ChatApplyOutcome<Applied> | Promise<ChatApplyOutcome<Applied>>
  undo: (applied: Applied) => string | null | Promise<string | null>
  replayOf?: (steps: Step[]) => { at: number; seconds: number } | null
  play?: (at: number, seconds: number) => void
  onReset: () => void
  clearTooltip: string
  /** Shown when the answer comes back after the member moved to another thread. */
  switchedMessage?: string
  /** Pointing at the preview: pins are kept per thread and go with the next message. */
  point?: {
    /** Suggestions shown while there are pins ("Put an arrow here"). */
    suggestions: readonly string[]
    /** A frame to point on in the panel (a review screen with no live preview); with it the panel has its own Point button. */
    pad?: ReactNode
    /** How to point when the preview is elsewhere (the clip editor's Output preview). */
    hint?: string
  }
}

export function ChatPanel<Step extends ChatStepBase, Applied>(props: ChatPanelProps<Step, Applied>): React.JSX.Element {
  const { threadKey: key, variant = 'editor' } = props
  const c = (name: string): string => `${variant === 'editor' ? 'editor-chat' : 'review-chat'}${name}`
  const read = (k: string): ChatEntry<Applied>[] => (threads.get(k) ?? []) as ChatEntry<Applied>[]
  const [entries, setEntries] = useState<ChatEntry<Applied>[]>(() => read(key))
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [info, setInfo] = useState<ChatInfo | null>(null)
  const [infoError, setInfoError] = useState<string | null>(null)
  const end = useRef<HTMLDivElement>(null)
  const pendingKey = useRef<string | null>(null)
  // The answer arrives later: apply it to the state as it is then, not as it was when asked.
  const latest = useRef(props); latest.current = props
  const keyLatest = useRef(key); keyLatest.current = key
  const points = useThreadPoints(props.point ? key : undefined)
  const pointing = useChatPointsStore((s) => !!props.point && s.pointing === key)
  const input = useRef<HTMLTextAreaElement>(null)
  // A new pin: the message box is next.
  const pinCount = useRef(points.length)
  useEffect(() => {
    if (points.length > pinCount.current) input.current?.focus({ preventScroll: true })
    pinCount.current = points.length
  }, [points.length])

  useEffect(() => { setEntries(read(key)); setDraft('') }, [key])
  useEffect(() => {
    let live = true
    const load = latest.current.loadInfo
    if (typeof load !== 'function') { setInfoError('Restart CreatorClips to use the chat.'); return }
    load().then((value) => { if (live) setInfo(value) }, (e) => { if (live) setInfoError(errorMessage(e)) })
    return () => { live = false }
  }, [])
  useEffect(() => { if (variant === 'editor') end.current?.scrollIntoView({ block: 'nearest' }) }, [entries.length, pending, variant])

  const update = (thread: string, change: (list: ChatEntry<Applied>[]) => ChatEntry<Applied>[]): void => {
    const next = change(read(thread))
    threads.set(thread, next as ChatEntry<unknown>[])
    if (thread === keyLatest.current) setEntries(next)
  }
  const reason = props.disabledReason ?? infoError ?? (info && !info.ready ? info.reason ?? 'The chat is not available.' : null)
  const disabled = !!reason || !info || pending

  const send = async (text: string): Promise<void> => {
    const message = text.trim()
    if (!message || disabled) return
    const thread = key
    const pins = latest.current.point ? useChatPointsStore.getState().points[thread] ?? [] : []
    pendingKey.current = thread
    setPending(true); setDraft('')
    update(thread, (list) => [...list, { id: nextId++, role: 'member', text: message, ...(pins.length ? { pins: pins.map((p) => `Pin ${p.n} · ${pointLabel(p)}`) } : {}) }])
    // Pins go with this message only.
    if (latest.current.point) useChatPointsStore.getState().clear(thread)
    try {
      const result = await latest.current.ask(message, pins)
      const steps = latest.current.parseSteps(result.steps)
      let card: ChatCard<Applied> | undefined
      const added: ChatEntry<Applied>[] = []
      if (steps.length) {
        // Only apply to the thread the question was about.
        const outcome: ChatApplyOutcome<Applied> = thread === keyLatest.current ? await latest.current.apply(steps) : { error: latest.current.switchedMessage ?? 'You switched to something else, so these changes were not made.' }
        if ('error' in outcome) added.push({ id: nextId++, role: 'error', text: outcome.error })
        else {
          const edits = steps.filter(latest.current.isEdit)
          const replay = latest.current.replayOf?.(steps) ?? null
          card = { lines: (edits.length ? edits : steps).map((s) => s.summary), length: edits.length ? outcome.length : null, state: 'open', applied: outcome.applied,
            ...(replay ? { replay } : {}) }
        }
      }
      if (result.reply || card) added.unshift({ id: nextId++, role: 'assistant', text: result.reply, ...(card ? { card } : {}) })
      if (result.error) added.push({ id: nextId++, role: 'error', text: result.error })
      if (!added.length) added.push({ id: nextId++, role: 'error', text: 'No answer came back. Try again.' })
      update(thread, (list) => [...list, ...added])
    } catch (e) {
      update(thread, (list) => [...list, { id: nextId++, role: 'error', text: errorMessage(e) }])
    } finally {
      if (pendingKey.current === thread) { pendingKey.current = null; setPending(false) }
    }
  }
  const setCard = (id: number, state: ChatCard<Applied>['state']): void => update(key, (list) => list.map((e) => e.id === id && e.card ? { ...e, card: { ...e.card, state } } : e))
  const [undoing, setUndoing] = useState(false)
  const undoCard = async (entry: ChatEntry<Applied>): Promise<void> => {
    if (!entry.card?.applied || undoing) return
    setUndoing(true)
    try {
      const failure = await props.undo(entry.card.applied)
      if (failure) update(key, (list) => [...list, { id: nextId++, role: 'error', text: failure }])
      else setCard(entry.id, 'undone')
    } catch (e) { update(key, (list) => [...list, { id: nextId++, role: 'error', text: errorMessage(e) }]) } finally { setUndoing(false) }
  }
  const clear = (): void => {
    update(key, () => [])
    props.onReset()
  }

  return <section className={c('')} aria-label={props.label}>
    <div className="flex items-start justify-between gap-2">
      <p className="text-2xs text-ink-subtle">{props.intro}</p>
      {entries.length > 0 && <Button size="sm" variant="ghost" iconOnly icon={<RotateCcw size={12} />} aria-label="Clear chat" tooltip={props.clearTooltip} disabled={pending} onClick={clear} />}
    </div>
    {reason && <p role="note" className={c('-reason')}>{reason}</p>}
    <div className={c('-log')} role="log" aria-label="Chat messages" aria-live="polite">
      {!entries.length && !pending && <p className="text-2xs text-ink-subtle flex items-center gap-1.5"><MessageSquare size={12} />No messages yet.</p>}
      {entries.map((entry) => <div key={entry.id} className={cn(c('-message'), entry.role)}>
        {entry.text && <p>{entry.text}</p>}
        {entry.pins && <ul className="chat-point-sent" aria-label="Pins sent">{entry.pins.map((pin) => <li key={pin}><MapPin size={10} aria-hidden />{pin}</li>)}</ul>}
        {entry.card && <div className={cn(c('-card'), entry.card.state)} role="group" aria-label="Chat changes">
          <ul>{entry.card.lines.map((line, i) => <li key={i}>{line}</li>)}</ul>
          {entry.card.length && <p className="text-ink-subtle">{entry.card.length}</p>}
          <div className="flex flex-wrap items-center gap-1.5">
            {entry.card.replay && props.play && <Button size="sm" variant="ghost" icon={<Play size={12} />} onClick={() => props.play!(entry.card!.replay!.at, entry.card!.replay!.seconds)}>Play again</Button>}
            {entry.card.applied !== null && entry.card.state === 'open' && <>
              <Button size="sm" icon={<Check size={12} />} onClick={() => setCard(entry.id, 'kept')}>Keep</Button>
              <Button size="sm" variant="ghost" icon={<Undo2 size={12} />} disabled={!!props.disabledReason || undoing} onClick={() => { void undoCard(entry) }}>Undo</Button>
            </>}
            {entry.card.state === 'kept' && <span className="text-2xs text-ink-subtle">Kept</span>}
            {entry.card.state === 'undone' && <span className="text-2xs text-ink-subtle">Undone</span>}
          </div>
        </div>}
      </div>)}
      {pending && <p role="status" className="text-2xs text-ink-muted flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" />Working on it…</p>}
      <div ref={end} />
    </div>
    <div className={c('-compose')}>
      {props.point?.pad && <div className="flex flex-wrap items-center gap-2">
        <PointButton thread={key} disabled={!!reason || pending} />
        <span className="text-2xs text-ink-subtle">{pointing ? 'Click or drag on the frame below. Esc cancels.' : 'Show where on the video, then ask, like “put an arrow here”.'}</span>
      </div>}
      {props.point?.pad && (pointing || points.length > 0) && props.point.pad}
      {props.point && <PointChips thread={key} />}
      <div className={c('-chips')} role="group" aria-label="Suggestions">
        {(props.point && points.length ? props.point.suggestions : props.suggestions).map((s) => <button key={s} type="button" disabled={disabled} onClick={() => { void send(s) }}>{s}</button>)}
      </div>
      <form className={c('-input')} onSubmit={(e) => { e.preventDefault(); void send(draft) }}>
        <textarea ref={input} aria-label="Message" rows={2} maxLength={CHAT_MAX_MESSAGE_CHARS} value={draft} disabled={!!reason || !info}
          placeholder={props.placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(draft) } }} />
        <Button type="submit" size="sm" variant="primary" iconOnly icon={<Send size={13} />} aria-label="Send" tooltip="Send (Enter). Shift+Enter adds a line." disabled={disabled || !draft.trim()} />
      </form>
      {props.point?.hint && !points.length && <p className="text-2xs text-ink-subtle">{props.point.hint}</p>}
      {info && <p className="text-2xs text-ink-subtle">{info.costNote} Model: {info.model}.</p>}
    </div>
  </section>
}
