import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Clapperboard, MessageSquare, RotateCcw, Sparkles, Wand2 } from 'lucide-react'
import {
  CUT_LABELS, CUTOUT_INTRO_SECONDS, SOUND_LABELS, MAX_HOOK_TEXT_CHARS, MAX_POPUP_TEXT_CHARS, RAW_INTRO_SECONDS, applyRecipe, cardProblem, chooseHook,
  formatClock, hookTextProblem, initialDecisions, reelCardWindows, reelSeconds, reelWordStarts, toggleSpan, toggleWord, type EditDecisions, type EditImage, type EditLook, type EditPlan, type EditStatus
} from '../../shared/edit-recording'
import { EDIT_CHAT_POINT_SUGGESTIONS, EDIT_CHAT_SUGGESTIONS, editPatchValues, mergeEditChatSteps, parseEditChatSteps, type EditChatPatch, type EditChatStep } from '../../shared/edit-chat'
import { editGraphicFrame, newEditGraphic, patchEditGraphic, type EditGraphic } from '../../shared/reel-graphics'
import { newGraphic, type GraphicTemplateId } from '../../shared/motion-graphics'
import { ChatPanel, type ChatApplyOutcome } from './ChatPanel'
import { PointPad } from './ChatPoints'
import { wordsAtPlayhead } from './ClipGraphics'
import { ReelGraphics, type ReelGraphicItem, type ReelGraphicPatch } from './ReelGraphics'
import { CardEditor, EditStylePicker, MyImages } from './EditExtras'
import { EditLog } from './EditLog'
import { editRecordingLog } from '../../shared/edit-log'
import { hasBrandMark } from '../../shared/brand-kit'
import type { BrandIdentity } from '../../shared/remix'
import { getApi } from '../lib/ipc'
import { useEditRecordingStore } from '../store/use-edit-recording-store'
import { cn, errorMessage } from '../lib/utils'
import { boardFromLook, extrasName, LOOK_HOOKS, lookPatch } from '../lib/style-board'
import { previewFrame, StyleBoard } from './StyleBoard'
import { Button } from './ui/Button'
import { Callout } from './ui/Callout'
import { TextInput } from './ui/Field'
import { Panel, PanelHeader } from './ui/Panel'
import { onRadioKeyDown } from './ui/Segmented'
import { SettingRow } from './ui/SettingRow'
import { Switch } from './ui/Switch'

/** Lines of the transcript (by take file, split at sentence ends) for the review. */
export function transcriptLines(plan: EditPlan): { src: number; words: number[] }[] {
  const lines: { src: number; words: number[] }[] = []
  plan.words.forEach((word, i) => {
    const last = lines[lines.length - 1]
    const previous = i > 0 ? plan.words[i - 1] : null
    const fresh = !last || last.src !== word.src || (previous && (/[.!?…]["')\]]*$/.test(previous.text) || word.startMs - previous.endMs > 1500))
    if (fresh) lines.push({ src: word.src, words: [i] })
    else last.words.push(i)
  })
  return lines
}

/**
 * Review the edit before it's made: the transcript with what's cut struck
 * through (click a word to keep or cut it; Shift-click cuts or keeps a span),
 * the hook it opens on (and the other hooks the AI found), pop-ups and sound
 * effects to switch on or off, and the look. Nothing here costs anything.
 */
export function EditReview({ status, brand, look, onLook, onError }: {
  status: EditStatus & { plan: EditPlan }
  brand: BrandIdentity | null
  look: EditLook
  onLook: (look: EditLook) => void
  onError: (error: string | null) => void
}): React.JSX.Element {
  const plan = status.plan
  // Choices made here outlive the page (by run id), so leaving and coming back keeps them.
  const [decisions, setDecisions] = useState<EditDecisions>(() => {
    const fresh = initialDecisions(plan, look, useEditRecordingStore.getState().recipe)
    const saved = useEditRecordingStore.getState().reviewFor(status.id)
    // Saved choices win; anything they don't have (a newer field) starts from the plan.
    return saved ? { ...fresh, ...saved } : fresh
  })
  // Images can be added or removed (here, or by main); kept in step with the status.
  const [images, setImages] = useState<EditImage[]>(status.images ?? [])
  useEffect(() => { setImages(status.images ?? []) }, [status.images])
  const [pinning, setPinning] = useState<string | null>(null)
  useEffect(() => { useEditRecordingStore.getState().saveReview(status.id, decisions) }, [status.id, decisions])
  // "What changed": the choices before the last Restore, so it can be taken back.
  const [beforeRestore, setBeforeRestore] = useState<EditDecisions | null>(null)
  const logLines = useMemo(() => editRecordingLog(plan, decisions), [plan, decisions])
  const [hooksOpen, setHooksOpen] = useState(false)
  const [lookOpen, setLookOpen] = useState(false)
  const [making, setMaking] = useState(false)
  const anchor = useRef<number | null>(null)
  const lines = useMemo(() => transcriptLines(plan), [plan])
  const cut = new Set(decisions.cut)
  const hook = plan.hooks.find((item) => item.id === decisions.hookId) ?? null
  const inHook = (i: number): boolean => Boolean(hook && i >= hook.start && i <= hook.end)
  const inCta = (i: number): boolean => Boolean(decisions.endOnCta && plan.cta && i >= plan.cta.start && i <= plan.cta.end)
  const seconds = reelSeconds(plan, decisions)
  const cutCount = decisions.cut.length
  const wordWhere = (index: number): string => `“${plan.words[index]?.text.replace(/[.,!?;:]+$/, '') ?? ''}”`
  const spanText = (start: number, end: number): string => plan.words.slice(start, end + 1).filter((_, k) => !cut.has(start + k)).map((word) => word.text).join(' ')
  const problem = hookTextProblem(decisions.hookText)
  const showMark = hasBrandMark(brand?.look)
  const cardTrouble = decisions.popups.some((item) => item.on && item.card && !cut.has(plan.popups.find((p) => p.id === item.id)?.word ?? -1) && cardProblem(item.card) !== null)
  const sources = status.sources
  // The preview shows the reel's own opening words.
  const previewWords = useMemo(() => plan.words.filter((_, i) => !cut.has(i)).slice(0, 8).map((word) => word.text), [plan.words, decisions.cut])

  // Graphics: each starts as its word is said; the strip runs over the reel's kept words (without the raw opening).
  const starts = useMemo(() => reelWordStarts(plan, decisions), [plan, decisions])
  const cardWindows = useMemo(() => reelCardWindows(plan, decisions, starts), [plan, decisions, starts])
  const reelLength = Math.max(1, seconds - (decisions.rawIntro ? RAW_INTRO_SECONDS : 0))
  const graphicFrame = useMemo(() => editGraphicFrame(decisions.hookText, look), [decisions.hookText, look])
  const graphics = decisions.graphics ?? []
  /** The kept word playing at `at` seconds of the reel (the last one starting at or before it). */
  const wordAt = (at: number): number | null => {
    let best: number | null = null, bestAt = -1, first: number | null = null, firstAt = Infinity
    for (const [i, t] of starts) {
      if (t <= at + 0.05 && t > bestAt) { best = i; bestAt = t }
      if (t < firstAt) { first = i; firstAt = t }
    }
    return best ?? first
  }
  const graphicItems: ReelGraphicItem[] = graphics.map((g) => {
    const at = starts.get(g.word) ?? null
    const card = at === null ? null : cardWindows.find((w) => at < w.end && at + g.duration_ms / 1000 > w.start)
    const { word: _word, ...rest } = g
    void _word
    return { ...rest, at, where: `on ${wordWhere(g.word)}`,
      problem: at === null ? 'Its word is cut, so it won’t show. Keep the word or start it on another one.' : card ? 'It plays during a card, so it will be left out. Move it after the card, or turn the card off.' : null }
  })
  /** A pop-up on this word would play during a graphic (it gives way to it). */
  const underGraphic = (word: number): boolean => {
    const at = starts.get(word)
    return at !== undefined && graphicItems.some((g) => !g.problem && g.at !== null && at < g.at + g.duration_ms / 1000 && at + 1.6 > g.at)
  }
  const setGraphics = (change: (list: EditGraphic[]) => EditGraphic[]): void => setDecisions((current) => ({ ...current, graphics: change(current.graphics ?? []) }))
  const addGraphic = (template: GraphicTemplateId, at: number): string | null => {
    const word = wordAt(at)
    if (word === null) return null
    const line = lines.find((l) => l.words.includes(word))?.words.filter((i) => i >= word).map((i) => plan.words[i].text).join(' ')
    const graphic = newEditGraphic(newGraphic(template, 0, { fields: wordsAtPlayhead(template, line), taken: graphics.map((g) => g.id) }), word)
    setGraphics((list) => [...list, graphic].sort((a, b) => a.word - b.word))
    return graphic.id
  }
  const patchGraphic = (id: string, patch: ReelGraphicPatch): void => {
    const { at, ...rest } = patch
    const word = at === undefined ? undefined : wordAt(at) ?? undefined
    setGraphics((list) => patchEditGraphic(list, id, { ...rest, ...(word !== undefined ? { word } : {}) }))
  }

  // The Chat panel works on the review's choices with the current look (extras live with the edit style).
  const chatState: EditDecisions = { ...decisions, look: { ...look, lookExtras: undefined }, graphics }
  const chatContext = { plan, images }
  const applyPatch = (patch: EditChatPatch): void => {
    const { look: nextLook, ...rest } = patch
    if (Object.keys(rest).length) setDecisions((current) => ({ ...current, ...rest }))
    if (nextLook) onLook({ ...look, includeCaptions: nextLook.includeCaptions, captionPreset: nextLook.captionPreset, headlineLook: nextLook.headlineLook, showHandle: nextLook.showHandle })
  }
  const applyChat = (steps: EditChatStep[]): ChatApplyOutcome<{ before: EditChatPatch }> => {
    const edits = steps.filter((step) => Object.keys(step.patch).length)
    if (!edits.length) return { applied: null, length: null }
    let patch: EditChatPatch
    try { patch = mergeEditChatSteps(chatState, edits, chatContext) } catch (error) { return { error: (error as Error).message } }
    const before = editPatchValues(chatState, Object.keys(patch) as (keyof EditChatPatch)[])
    applyPatch(patch)
    return { applied: { before }, length: `Your reel is now about ${formatClock(reelSeconds(plan, { ...chatState, ...patch }))} long.` }
  }

  const clickWord = (i: number, shift: boolean): void => {
    if (pinning) {
      const image = pinning
      setDecisions((current) => current.pins.some((pin) => pin.image === image && pin.word === i) ? current : { ...current, pins: [...current.pins, { image, word: i }] })
      setPinning(null)
      return
    }
    if (shift && anchor.current !== null) setDecisions((current) => toggleSpan(current, anchor.current as number, i))
    else setDecisions((current) => toggleWord(current, i))
    anchor.current = i
  }

  const make = async (): Promise<void> => {
    setMaking(true); onError(null)
    const known = new Set(images.map((image) => image.id))
    try { await getApi().edit.render({ ...decisions, look, pins: decisions.pins.filter((pin) => known.has(pin.image)) }) } catch (err) { onError(errorMessage(err, 'Your reel could not be made.')) } finally { setMaking(false) }
  }


  return (
    <Panel>
      <PanelHeader title="Review your edit" icon={<Wand2 className="h-4 w-4" />}
        description={`About ${formatClock(seconds)} long · ${cutCount} word${cutCount === 1 ? '' : 's'} cut${sources.length > 1 ? ` · from ${sources.length} takes` : ''}. Nothing is paid for here: making the reel is done on this computer.`} />
      {(plan.notes.length > 0 || status.transcriber) && (
        <p className="mt-2 text-2xs text-ink-muted" data-testid="edit-notes">
          {[...plan.notes, status.transcriber === 'scribe' ? 'Transcribed with ElevenLabs Scribe v2.' : status.transcriber === 'standard' ? 'Transcribed with the usual transcription (Scribe wasn’t available).' : ''].filter(Boolean).join(' ')}
        </p>
      )}
      {status.warnings.map((warning) => <Callout key={warning} tone="warning" className="mt-3">{warning}</Callout>)}

      <EditLog className="mt-4" lines={logLines} disabled={making}
        onRestore={(line) => { if (!line.restore) return; setBeforeRestore(decisions); setDecisions((current) => ({ ...current, ...line.restore })) }}
        onUndo={beforeRestore ? () => { setDecisions(beforeRestore); setBeforeRestore(null) } : undefined} />

      <EditStylePicker recipe={decisions.recipe} extras={decisions.lookExtras}
        onRecipe={(id) => { useEditRecordingStore.getState().setRecipe(id); setDecisions((current) => applyRecipe(plan, current, id)) }}
        onExtras={(lookExtras) => setDecisions((current) => ({ ...current, lookExtras }))} />

      <section className="glass-tile mt-4 rounded-2xl p-3" aria-labelledby="edit-chat-title">
        <h3 id="edit-chat-title" className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink"><MessageSquare className="h-4 w-4" aria-hidden />Chat</h3>
        <ChatPanel<EditChatStep, { before: EditChatPatch }>
          variant="review" threadKey={`edit\n${status.id}`} label="Chat about your edit"
          intro="Ask for a change in your own words, like “remove the second retake” or “add a stat card when I say 40%”. Each answer shows what changed, with Keep or Undo."
          placeholder="Ask for a change to your edit" suggestions={EDIT_CHAT_SUGGESTIONS}
          disabledReason={making ? 'Your reel is being made.' : null}
          loadInfo={typeof getApi().edit.chatInfo === 'function' ? () => getApi().edit.chatInfo() : undefined}
          ask={(message, points) => getApi().edit.chat(chatState, message, points)}
          point={{ suggestions: EDIT_CHAT_POINT_SUGGESTIONS, pad: <PointPad thread={`edit\n${status.id}`} video={sources[0]?.path} /> }}
          parseSteps={parseEditChatSteps} isEdit={(step) => Object.keys(step.patch).length > 0}
          apply={applyChat}
          undo={(applied) => { applyPatch(applied.before); return null }}
          onReset={() => { void getApi().edit.chatReset?.().catch(() => {}) }}
          clearTooltip="Start a new chat about this edit. Your changes stay." />
      </section>

      <section className="mt-4 space-y-2" aria-labelledby="edit-hook-title">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 id="edit-hook-title" className="text-sm font-semibold text-ink">Opens with</h3>
            <p className="mt-0.5 text-sm text-ink" data-testid="edit-hook">{hook ? `“${spanText(hook.start, hook.end)}”` : 'Your video starts from the beginning.'}</p>
            {hook?.why && <p className="text-2xs text-ink-subtle">{hook.why}</p>}
          </div>
          {plan.hooks.length > 1 && (
            <Button size="sm" variant="secondary" icon={<Sparkles className="h-3.5 w-3.5" />} aria-expanded={hooksOpen} onClick={() => setHooksOpen(!hooksOpen)}>Use a different hook</Button>
          )}
        </div>
        {hooksOpen && (
          <div className="grid gap-2" role="radiogroup" aria-label="Hook">
            {[...plan.hooks.map((item) => ({ id: item.id as number | null, label: item.text, quote: `“${plan.words.slice(item.start, item.end + 1).map((w) => w.text).join(' ')}”`, why: item.why })),
              { id: null, label: 'No hook', quote: 'Start from the beginning, as recorded.', why: '' }].map((option) => {
              const selected = decisions.hookId === option.id
              return (
                <button key={String(option.id)} type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1} onKeyDown={onRadioKeyDown}
                  onClick={() => setDecisions((current) => chooseHook(plan, current, option.id))}
                  className={cn('glass-tile glass-tile-hover rounded-xl px-3 py-2.5 text-left', selected ? 'glass-selected text-ink' : 'text-ink-muted hover:text-ink')}>
                  <span className="block text-xs font-medium">{option.label}</span>
                  <span className="block text-2xs text-ink-muted">{option.quote}</span>
                  {option.why && <span className="block text-2xs text-ink-subtle">{option.why}</span>}
                </button>
              )
            })}
          </div>
        )}
        <label className="block">
          <span className="mb-1 block text-xs text-ink-muted">Hook text on screen</span>
          <TextInput aria-label="Hook text on screen" value={decisions.hookText} maxLength={MAX_HOOK_TEXT_CHARS} placeholder="Leave empty for no hook text"
            onChange={(e) => setDecisions((current) => ({ ...current, hookText: e.target.value }))} />
        </label>
        {problem && <p className="text-2xs text-danger">{problem}</p>}
      </section>

      <section className="mt-5" aria-labelledby="edit-transcript-title">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 id="edit-transcript-title" className="text-sm font-semibold text-ink">Your words</h3>
            <p className="text-2xs text-ink-subtle">{pinning ? 'Click the word where your image should pop up.' : 'Struck-through words are cut. Click a word to keep or cut it; Shift-click another word to keep or cut everything between them.'}</p>
          </div>
          <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => setDecisions((current) => ({ ...current, cut: initialDecisions(plan).cut }))}>Back to the AI’s cut</Button>
        </div>
        <div className="mt-2 max-h-[420px] space-y-1.5 overflow-y-auto rounded-xl bg-black/20 p-3 text-sm leading-7" data-testid="edit-transcript">
          {lines.map((line, n) => (
            <div key={n}>
              {sources.length > 1 && (n === 0 || lines[n - 1].src !== line.src) && (
                <p className="eyebrow mt-2 text-[10px] text-ink-faint first:mt-0">Take {line.src + 1} · {sources[line.src]?.name}</p>
              )}
              <p>
                {line.words.map((i) => {
                  const word = plan.words[i]
                  const isCut = cut.has(i)
                  const reason = isCut ? (word.cut ?? 'member') : null
                  const pinned = decisions.pins.some((pin) => pin.word === i)
                  return (
                    <button key={i} type="button" data-word={i} aria-pressed={!isCut} data-pinned={pinned || undefined}
                      title={pinning ? 'Pin your image here.' : reason ? `${CUT_LABELS[reason]}. Click to keep it.` : 'Click to cut it.'}
                      onClick={(e) => clickWord(i, e.shiftKey)}
                      className={cn('mr-1 rounded px-0.5 transition-colors hover:bg-white/10',
                        isCut ? 'text-ink-faint line-through decoration-danger/70' : 'text-ink',
                        !isCut && inHook(i) && 'bg-accent/15 text-accent', !isCut && inCta(i) && 'underline decoration-accent decoration-2 underline-offset-4',
                        pinned && 'ring-1 ring-accent/70', pinning && 'cursor-copy')}>
                      {word.text}
                    </button>
                  )
                })}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-1 text-2xs text-ink-subtle"><span className="text-accent">Highlighted</span>: plays first, as your hook.{plan.cta ? ' Underlined: your call to action, at the end.' : ''}</p>
      </section>

      {plan.cta && (
        <SettingRow className="mt-4" title="End on your call to action" description={`“${spanText(plan.cta.start, plan.cta.end)}” moves to the end.`}
          control={<Switch label="End on your call to action" checked={decisions.endOnCta} onChange={(endOnCta) => setDecisions((current) => ({ ...current, endOnCta }))} />} />
      )}

      {(plan.popups.length > 0 || plan.sounds.length > 0) && (
        <section className="mt-5 space-y-2" aria-labelledby="edit-extras-title">
          <h3 id="edit-extras-title" className="text-sm font-semibold text-ink">{plan.popups.some((p) => p.kind === 'card') ? 'Cards, pop-ups and sounds' : 'Pop-ups and sounds'}</h3>
          {plan.popups.filter((popup) => popup.kind === 'card').map((popup, n) => {
            const choice = decisions.popups.find((item) => item.id === popup.id)
            const card = choice?.card ?? popup.card
            if (!card) return null
            const update = (patch: Partial<{ on: boolean; card: typeof card }>): void =>
              setDecisions((current) => ({ ...current, popups: current.popups.map((item) => item.id === popup.id ? { ...item, ...patch } : item) }))
            return (
              <CardEditor key={`c${popup.id}`} index={n} card={card} on={Boolean(choice?.on)} removed={cut.has(popup.word)} where={wordWhere(popup.word)}
                seconds={popup.seconds ?? 3} onChange={(next) => update({ card: next })} onToggle={(on) => update({ on })} />
            )
          })}
          {plan.popups.filter((popup) => popup.kind !== 'card').map((popup, n) => {
            const choice = decisions.popups.find((item) => item.id === popup.id)
            const removed = cut.has(popup.word)
            return (
              <div key={`p${popup.id}`} className="flex flex-wrap items-center gap-2">
                <Switch label={`Pop-up ${n + 1}`} checked={Boolean(choice?.on) && !removed} disabled={removed}
                  onChange={(on) => setDecisions((current) => ({ ...current, popups: current.popups.map((item) => item.id === popup.id ? { ...item, on } : item) }))} />
                <TextInput aria-label={`Pop-up ${n + 1} text`} className="w-44" value={choice?.text ?? popup.text} maxLength={MAX_POPUP_TEXT_CHARS} disabled={!choice?.on || removed}
                  onChange={(e) => setDecisions((current) => ({ ...current, popups: current.popups.map((item) => item.id === popup.id ? { ...item, text: e.target.value } : item) }))} />
                <span className="text-2xs text-ink-subtle">{removed ? 'Its word is cut, so it won’t show.' : underGraphic(popup.word) ? `A graphic plays when you say ${wordWhere(popup.word)}, so this pop-up won’t show.` : `Pops up when you say ${wordWhere(popup.word)}`}</span>
              </div>
            )
          })}
          {plan.sounds.map((sound) => {
            const choice = decisions.sounds.find((item) => item.id === sound.id)
            const where = sound.at === 'title' ? 'as the hook text appears' : `on ${wordWhere(sound.at)}`
            return (
              <SettingRow key={`s${sound.id}`} title={`${SOUND_LABELS[sound.sound]} ${where}`} description={sound.at !== 'title' && cut.has(sound.at) ? 'Its word is cut, so it won’t play.' : 'Mixed softly under your voice.'}
                control={<Switch label={`${SOUND_LABELS[sound.sound]} ${where}`} checked={Boolean(choice?.on)}
                  onChange={(on) => setDecisions((current) => ({ ...current, sounds: current.sounds.map((item) => item.id === sound.id ? { ...item, on } : item) }))} />} />
            )
          })}
        </section>
      )}

      <section className="mt-5">
        <ReelGraphics label="Graphics" intro="Animated cards over your reel: a stat that counts up, a title, a list and more. Each starts as a word is said, and stays clear of your hook text and captions. A graphic can’t play during a card."
          items={graphicItems} totalSeconds={reelLength} blocked={cardWindows.map((w) => ({ start: w.start, end: w.end, label: 'A card plays here' }))}
          frame={graphicFrame} look={look.headlineLook} disabled={making} emptyNote={null}
          onAdd={addGraphic} onPatch={patchGraphic} onRemove={(id) => setGraphics((list) => list.filter((g) => g.id !== id))}
          cursorLabel={(at) => { const word = wordAt(at); return word === null ? 'at the start' : `on ${wordWhere(word)} (${formatClock(starts.get(word) ?? 0)})` }} />
      </section>

      <MyImages images={images} pins={decisions.pins} wordText={wordWhere} pinning={pinning} onPinning={setPinning} onError={onError}
        onImages={(next) => { setImages(next); setDecisions((current) => ({ ...current, pins: current.pins.filter((pin) => next.some((image) => image.id === pin.image)) })) }}
        onUnpin={(gone) => setDecisions((current) => ({ ...current, pins: current.pins.filter((pin) => pin.image !== gone.image || pin.word !== gone.word) }))} />

      <section className="mt-5 space-y-2" aria-labelledby="edit-openings-title">
        <h3 id="edit-openings-title" className="text-sm font-semibold text-ink">How it opens</h3>
        <SettingRow title="Cut-out opening" description={`For the first ${CUTOUT_INTRO_SECONDS} seconds your background is removed and you stand in front of a blurred collage of your images (or stills of your video).`}
          control={<Switch label="Cut-out opening" checked={decisions.cutoutIntro} onChange={(cutoutIntro) => setDecisions((current) => ({ ...current, cutoutIntro }))} />} />
        <SettingRow title="Raw-to-edited opening" description={`A ${RAW_INTRO_SECONDS}-second card first shows your raw take, with the pauses and retakes that were cut marked in red, then your reel starts.`}
          control={<Switch label="Raw-to-edited opening" checked={decisions.rawIntro} onChange={(rawIntro) => setDecisions((current) => ({ ...current, rawIntro }))} />} />
      </section>

      <section className="mt-5 rounded-2xl bg-white/[0.03] p-3">
        <button type="button" className="flex w-full items-start justify-between gap-3 text-left" aria-expanded={lookOpen} aria-controls="edit-look" onClick={() => setLookOpen(!lookOpen)}>
          <span>
            <span className="block text-sm font-semibold text-ink">Look</span>
            <span className="block text-2xs text-ink-muted" data-testid="edit-look-summary">
              {[look.includeCaptions ? `Captions: ${look.captionPreset}` : 'No captions', `Hook text: ${look.headlineLook.look}`, showMark && look.showHandle ? 'Your handle' : '',
                decisions.lookExtras?.length ? `Extras: ${extrasName(decisions.lookExtras)}` : ''].filter(Boolean).join(' · ')}
            </span>
          </span>
          <ChevronDown className={cn('mt-0.5 h-4 w-4 shrink-0 text-ink-muted transition-transform', lookOpen && 'rotate-180')} />
        </button>
        {lookOpen && (
          <div id="edit-look" className="mt-3 space-y-4">
            <p className="text-2xs text-ink-subtle">These start from your Brand Identity’s look.</p>
            <StyleBoard value={boardFromLook({ ...look, lookExtras: decisions.lookExtras })} onChange={(patch) => {
              // Extras live with the edit style (one list for both pickers); the rest is the look.
              if (patch.extras) { const lookExtras = patch.extras; setDecisions((current) => ({ ...current, lookExtras })) }
              const { extras: _extras, ...rest } = patch
              void _extras
              onLook({ ...look, ...lookPatch(look, rest) })
            }}
              rows={{ hooks: LOOK_HOOKS, handle: true, extras: true }} brand={brand} frame={previewFrame(sources[0]?.path, 'video', 0.1)}
              hookText={decisions.hookText} words={previewWords} />
          </div>
        )}
      </section>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" disabled={making} onClick={() => void getApi().edit.discard().catch((err: unknown) => onError(errorMessage(err)))}>Start over</Button>
        <Button variant="primary" size="lg" icon={<Clapperboard className="h-4 w-4" />} loading={making} disabled={making || problem !== null || seconds < 1.5 || cardTrouble}
          onClick={() => void make()}>Make my reel</Button>
      </div>
    </Panel>
  )
}
