import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, MessageSquare, Play, RotateCcw, Send, Undo2 } from 'lucide-react'
import { getApi } from '../lib/ipc'
import { cn, errorMessage } from '../lib/utils'
import { Button } from './ui/Button'
import { CHAT_MAX_MESSAGE_CHARS, CHAT_SUGGESTIONS, parseChatSteps, type ChatInfo, type ChatPatch, type ChatStep } from '../../shared/clip-chat'
import { candidateEdit, type EditorCandidate } from '../../shared/clip-editor'

/** What applying a chat answer changed, so its card can undo it. */
export interface ChatApplied { clipId: string; before: ChatPatch; afterKey: string }
export type ChatApplyResult = { applied: ChatApplied | null; length: string | null } | { error: string }

interface ChatCard {
  lines: string[]
  /** "Clip is now 37.7s." */
  length: string | null
  state: 'open' | 'kept' | 'undone'
  applied: ChatApplied | null
  /** A moment the answer played, to play again. */
  replay?: { at: number; seconds: number }
}
interface ChatEntry { id: number; role: 'member' | 'assistant' | 'error'; text: string; card?: ChatCard }

// Each clip's conversation for this app session (main keeps the model's side the same way).
const threads = new Map<string, ChatEntry[]>()
let nextId = 1

export function ClipChat({ outputDir, candidate, disabledReason, apply, undo, play }: {
  outputDir: string
  candidate: EditorCandidate
  /** Why editing is off right now (busy, discarded), or null. */
  disabledReason: string | null
  apply: (steps: ChatStep[]) => ChatApplyResult
  undo: (applied: ChatApplied) => string | null
  play: (at: number, seconds: number) => void
}): React.JSX.Element {
  const key = `${outputDir}\n${candidate.id}`
  const [entries, setEntries] = useState<ChatEntry[]>(() => threads.get(key) ?? [])
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [info, setInfo] = useState<ChatInfo | null>(null)
  const [infoError, setInfoError] = useState<string | null>(null)
  const end = useRef<HTMLDivElement>(null)
  const pendingKey = useRef<string | null>(null)
  // The answer arrives later: apply it to the clip as it is then, not as it was when asked.
  const applyLatest = useRef(apply); applyLatest.current = apply
  const keyLatest = useRef(key); keyLatest.current = key

  useEffect(() => { setEntries(threads.get(key) ?? []); setDraft('') }, [key])
  useEffect(() => {
    let live = true
    if (typeof getApi().editor.chatInfo !== 'function') { setInfoError('Restart CreatorClips to use the chat.'); return }
    getApi().editor.chatInfo().then((value) => { if (live) setInfo(value) }, (e) => { if (live) setInfoError(errorMessage(e)) })
    return () => { live = false }
  }, [])
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }) }, [entries.length, pending])

  const update = (clip: string, change: (list: ChatEntry[]) => ChatEntry[]): void => {
    const next = change(threads.get(clip) ?? [])
    threads.set(clip, next)
    if (clip === keyLatest.current) setEntries(next)
  }
  const reason = disabledReason ?? infoError ?? (info && !info.ready ? info.reason ?? 'The chat is not available.' : null)
  const disabled = !!reason || !info || pending

  const send = async (text: string): Promise<void> => {
    const message = text.trim()
    if (!message || disabled) return
    const clip = key
    pendingKey.current = clip
    setPending(true); setDraft('')
    update(clip, (list) => [...list, { id: nextId++, role: 'member', text: message }])
    try {
      const result = await getApi().editor.chat(outputDir, candidateEdit(candidate), message)
      const steps = parseChatSteps(result.steps)
      let card: ChatCard | undefined
      const added: ChatEntry[] = []
      if (steps.length) {
        // Only apply to the clip the question was about.
        const outcome: ChatApplyResult = clip === keyLatest.current ? applyLatest.current(steps) : { error: 'You switched clips, so these changes were not made.' }
        if ('error' in outcome) added.push({ id: nextId++, role: 'error', text: outcome.error })
        else {
          const edits = steps.filter((s) => Object.keys(s.patch).length)
          const replay = steps.find((s) => s.tool === 'play' && s.focus_ms !== null)
          card = { lines: (edits.length ? edits : steps).map((s) => s.summary), length: edits.length ? outcome.length : null, state: 'open', applied: outcome.applied,
            ...(replay ? { replay: { at: replay.focus_ms!, seconds: replay.play_seconds || 3 } } : {}) }
        }
      }
      if (result.reply || card) added.unshift({ id: nextId++, role: 'assistant', text: result.reply, ...(card ? { card } : {}) })
      if (result.error) added.push({ id: nextId++, role: 'error', text: result.error })
      if (!added.length) added.push({ id: nextId++, role: 'error', text: 'No answer came back. Try again.' })
      update(clip, (list) => [...list, ...added])
    } catch (e) {
      update(clip, (list) => [...list, { id: nextId++, role: 'error', text: errorMessage(e) }])
    } finally {
      if (pendingKey.current === clip) { pendingKey.current = null; setPending(false) }
    }
  }
  const setCard = (id: number, state: ChatCard['state']): void => update(key, (list) => list.map((e) => e.id === id && e.card ? { ...e, card: { ...e.card, state } } : e))
  const undoCard = (entry: ChatEntry): void => {
    if (!entry.card?.applied) return
    const failure = undo(entry.card.applied)
    if (failure) update(key, (list) => [...list, { id: nextId++, role: 'error', text: failure }])
    else setCard(entry.id, 'undone')
  }
  const clear = (): void => {
    update(key, () => [])
    void getApi().editor.chatReset?.(outputDir, candidate.id).catch(() => {})
  }

  return <section className="editor-chat" aria-label="Chat about this clip">
    <div className="flex items-start justify-between gap-2">
      <p className="text-2xs text-ink-subtle">Ask for a change in your own words, like “start with the laugh before she answers”. Changes go through Undo like any edit.</p>
      {entries.length > 0 && <Button size="sm" variant="ghost" iconOnly icon={<RotateCcw size={12} />} aria-label="Clear chat" tooltip="Start a new chat about this clip. Your edits stay." disabled={pending} onClick={clear} />}
    </div>
    {reason && <p role="note" className="editor-chat-reason">{reason}</p>}
    <div className="editor-chat-log" role="log" aria-label="Chat messages" aria-live="polite">
      {!entries.length && !pending && <p className="text-2xs text-ink-subtle flex items-center gap-1.5"><MessageSquare size={12} />No messages yet.</p>}
      {entries.map((entry) => <div key={entry.id} className={cn('editor-chat-message', entry.role)}>
        {entry.text && <p>{entry.text}</p>}
        {entry.card && <div className={cn('editor-chat-card', entry.card.state)} role="group" aria-label="Chat changes">
          <ul>{entry.card.lines.map((line, i) => <li key={i}>{line}</li>)}</ul>
          {entry.card.length && <p className="text-ink-subtle">{entry.card.length}</p>}
          <div className="flex flex-wrap items-center gap-1.5">
            {entry.card.replay && <Button size="sm" variant="ghost" icon={<Play size={12} />} onClick={() => play(entry.card!.replay!.at, entry.card!.replay!.seconds)}>Play again</Button>}
            {entry.card.applied && entry.card.state === 'open' && <>
              <Button size="sm" icon={<Check size={12} />} onClick={() => setCard(entry.id, 'kept')}>Keep</Button>
              <Button size="sm" variant="ghost" icon={<Undo2 size={12} />} disabled={!!disabledReason} onClick={() => undoCard(entry)}>Undo</Button>
            </>}
            {entry.card.state === 'kept' && <span className="text-2xs text-ink-subtle">Kept</span>}
            {entry.card.state === 'undone' && <span className="text-2xs text-ink-subtle">Undone</span>}
          </div>
        </div>}
      </div>)}
      {pending && <p role="status" className="text-2xs text-ink-muted flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" />Working on it…</p>}
      <div ref={end} />
    </div>
    <div className="editor-chat-compose">
      <div className="editor-chat-chips" role="group" aria-label="Suggestions">
        {CHAT_SUGGESTIONS.map((s) => <button key={s} type="button" disabled={disabled} onClick={() => { void send(s) }}>{s}</button>)}
      </div>
      <form className="editor-chat-input" onSubmit={(e) => { e.preventDefault(); void send(draft) }}>
        <textarea aria-label="Message" rows={2} maxLength={CHAT_MAX_MESSAGE_CHARS} value={draft} disabled={!!reason || !info}
          placeholder="Ask for a change to this clip"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(draft) } }} />
        <Button type="submit" size="sm" variant="primary" iconOnly icon={<Send size={13} />} aria-label="Send" tooltip="Send (Enter). Shift+Enter adds a line." disabled={disabled || !draft.trim()} />
      </form>
      {info && <p className="text-2xs text-ink-subtle">{info.costNote} Model: {info.model}.</p>}
    </div>
  </section>
}
