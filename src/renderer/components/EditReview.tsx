import { useEffect, useMemo, useRef, useState } from 'react'
import { BookmarkPlus, ChevronDown, Clapperboard, Eraser, LayoutGrid, Layers, MessageSquare, RotateCcw, Sparkles, Wand2 } from 'lucide-react'
import {
  CUT_LABELS, CUTOUT_INTRO_SECONDS, SOUND_LABELS, soundEffectsOn, MAX_HOOK_TEXT_CHARS, MAX_POPUP_TEXT_CHARS, RAW_INTRO_SECONDS, applyRecipe, cardProblem, chooseHook,
  formatClock, hookTextProblem, initialDecisions, reelCardWindows, reelOrder, reelSeconds, reelWordStarts, toggleSpan, toggleWord, type EditDecisions, type EditImage, type EditLook, type EditPlan, type EditStatus
} from '../../shared/edit-recording'
import { EDIT_CHAT_POINT_SUGGESTIONS, EDIT_CHAT_SUGGESTIONS, editPatchValues, mergeEditChatSteps, parseEditChatSteps, type EditChatPatch, type EditChatStep } from '../../shared/edit-chat'
import { MAX_EDIT_GRAPHICS, editGraphicFrame, newEditGraphic, patchEditGraphic, type EditGraphic } from '../../shared/reel-graphics'
import { newGraphic, templateInfo, type GraphicTemplateId } from '../../shared/motion-graphics'
import { FX_EFFECTS, fxEffect } from '../../shared/fx-catalog'
import { prefillEffect } from '../../shared/graphic-prefill'
import { findDuplicateExtras, type DuplicateShown } from '../../shared/edit-duplicates'
import { ChatPanel, type ChatApplyOutcome } from './ChatPanel'
import { PointPad, VideoStill } from './ChatPoints'
import { wordsAtPlayhead } from './ClipGraphics'
import { ReelGraphics, type ReelGraphicItem, type ReelGraphicPatch } from './ReelGraphics'
import { CardEditor, EditStylePicker, MyImages } from './EditExtras'
import { EditLog } from './EditLog'
import { ClipOrder } from './CombineClips'
import { SHOT_LABELS } from '../../shared/combine-clips'
import { applyRestore, editRecordingLog, restoreStillApplied, undoRestore, type RestoreUndo } from '../../shared/edit-log'
import { SkillsPanel } from './SkillsPanel'
import { BeatSheet } from './BeatSheet'
import { beforeRender } from '../../shared/beat-sheet'
import { useMemberPrefsStore } from '../store/use-member-prefs-store'
import { densityCount, densitySummary, dressItUp, keepItClean, type DensityChange } from '../../shared/edit-density'
import { decisionsWithEditStyle, decisionsWithMyLook, myLookFrom } from '../../shared/my-look'
import { COLOR_GRADE_INFO } from '../../shared/color-grade'
import { ColorGradePicker } from './ColorGradePicker'
import { Dialog, DialogFooter } from './ui/Dialog'
import { ScreenChoicePanel } from './ScreenRecording'
import { DEFAULT_SCREEN_CHOICE } from '../../shared/screen-pair'
import { DEFAULT_YOUTUBE_CHOICE } from '../../shared/longform'
import { YoutubeChoicePanel } from './YoutubeFormat'
import { editSkillPatch, editSkillRows } from '../../shared/skills'
import { DEFAULT_SOUND_REGISTER, SOUND_REGISTERS } from '../../shared/sound-design'
import { REGISTER_INFO, registerKeeps } from '../../shared/register'
import { BrollSourcePicker, useBrollLibraryLoaded, useEffectiveBrollSource } from './BrollSourcePicker'
import { useSettingsStore } from '../store/use-settings-store'
import { hasBrandMark } from '../../shared/brand-kit'
import type { BrandIdentity } from '../../shared/remix'
import { getApi } from '../lib/ipc'
import { useEditRecordingStore } from '../store/use-edit-recording-store'
import { cn, errorMessage, localFileUrl } from '../lib/utils'
import { boardFromLook, extrasName, LOOK_HOOKS, lookPatch } from '../lib/style-board'
import { previewFrame, StyleBoard } from './StyleBoard'
import { Button } from './ui/Button'
import { Callout } from './ui/Callout'
import { TextInput } from './ui/Field'
import { Panel, PanelHeader } from './ui/Panel'
import { onRadioKeyDown, Segmented } from './ui/Segmented'
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
 * effects to switch on or off, and the look. Making the reel costs nothing;
 * chat messages use the member's OpenRouter credit.
 */
export function EditReview({ status, brand, look, onLook, onError }: {
  status: EditStatus & { plan: EditPlan }
  brand: BrandIdentity | null
  look: EditLook
  onLook: (look: EditLook) => void
  onError: (error: string | null) => void
}): React.JSX.Element {
  const plan = status.plan
  // B-roll (Skills): where it comes from when switched on (My library when it has shots).
  useBrollLibraryLoaded()
  // With no library shots and no Pexels key, switching B-roll on here picks AI (the picker then shows its estimate before anything is made).
  const openrouter = useSettingsStore((s) => s.openrouterConfigured)
  const brollDefault = useEffectiveBrollSource(null) ?? (openrouter ? 'ai' : null)
  // Choices made here outlive the page (by run id), so leaving and coming back keeps them.
  const [decisions, setDecisions] = useState<EditDecisions>(() => {
    const fresh = initialDecisions(plan, look, useEditRecordingStore.getState().recipe)
    const saved = useEditRecordingStore.getState().reviewFor(status.id)
    // A new review starts from the Style and sound of the member's last reel, then their saved look ("Use my look").
    const prefs = useMemberPrefsStore.getState()
    const remembered = decisionsWithEditStyle(fresh, prefs.editStyle)
    const first = prefs.useMyLook && prefs.myLook ? decisionsWithMyLook(remembered, prefs.myLook) : remembered
    // Saved choices win; anything they don't have (a newer field) starts from the plan.
    const start = saved ? { ...fresh, ...saved } : first
    // Camera + screen: how the two share the frame.
    const withScreen = status.screen && !start.screen ? { ...start, screen: { ...DEFAULT_SCREEN_CHOICE } } : start
    // A YouTube video: its layout and captions (defaults: a large webcam card on the right, captions on key lines).
    return status.format === 'youtube' && !withScreen.youtube ? { ...withScreen, youtube: { ...DEFAULT_YOUTUBE_CHOICE, ...(status.screen ? {} : { layout: 'full' as const }) } } : withScreen
  })
  // Images can be added or removed (here, or by main); kept in step with the status.
  const [images, setImages] = useState<EditImage[]>(status.images ?? [])
  useEffect(() => { setImages(status.images ?? []) }, [status.images])
  const [pinning, setPinning] = useState<string | null>(null)
  useEffect(() => { useEditRecordingStore.getState().saveReview(status.id, decisions) }, [status.id, decisions])
  // "What changed": what the last Restore changed, so it (and only it) can be taken back.
  const [lastRestore, setLastRestore] = useState<RestoreUndo<EditDecisions> | null>(null)
  // A field the Restore set changed again since: Undo would throw that away, so it's no longer offered.
  useEffect(() => { if (lastRestore && !restoreStillApplied(decisions, lastRestore)) setLastRestore(null) }, [decisions, lastRestore])
  const logLines = useMemo(() => editRecordingLog(plan, decisions, status.sources), [plan, decisions, status.sources])
  // Style and sound are remembered for the next video once the member changes them here.
  const firstStyle = useRef({ soundStyle: decisions.soundStyle, soundEffects: decisions.soundEffects })
  useEffect(() => {
    const first = firstStyle.current
    if (decisions.soundStyle === first.soundStyle && decisions.soundEffects === first.soundEffects) return
    firstStyle.current = { soundStyle: decisions.soundStyle, soundEffects: decisions.soundEffects }
    const editStyle = { ...(decisions.soundStyle ? { register: decisions.soundStyle } : {}), ...(decisions.soundEffects !== undefined ? { soundEffects: decisions.soundEffects } : {}) }
    void useMemberPrefsStore.getState().saveApp({ editStyle }).catch(() => undefined)
  }, [decisions.soundStyle, decisions.soundEffects])
  // Quick controls: "Dress it up" / "Keep it clean" (what changed, with Undo) and "Save as my look".
  const [density, setDensity] = useState<{ change: DensityChange; before: EditDecisions } | null>(null)
  const [lookSaved, setLookSaved] = useState<string | null>(null)
  const applyDensity = (kind: 'dress' | 'clean'): void => {
    const change = kind === 'dress' ? dressItUp(plan, decisions) : keepItClean(plan, decisions)
    setDensity({ change, before: decisions })
    if (densityCount(change)) setDecisions(change.decisions)
  }
  const densityUndo = density && densityCount(density.change) > 0 && density.change.decisions === decisions ? density.before : null
  const saveMyLook = (): void => {
    setLookSaved(null)
    void useMemberPrefsStore.getState().saveApp({ myLook: myLookFrom(look, decisions) })
      .then(() => setLookSaved('Saved as your look. Your next Edit my recording or Combine starts from it.'))
      .catch((err: unknown) => onError(errorMessage(err)))
  }
  const [hooksOpen, setHooksOpen] = useState(false)
  const [lookOpen, setLookOpen] = useState(false)
  const [making, setMaking] = useState(false)
  // The beat sheet: every on-screen moment as a numbered still (offered before the reel is made, as the member chose).
  const [view, setView] = useState<'edit' | 'beats'>('edit')
  const [offer, setOffer] = useState(false)
  const beatChoice = useMemberPrefsStore((s) => s.beatSheet)
  const chatReady = useSettingsStore((s) => s.openrouterConfigured)
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
  // Camera + screen reels: no pop-ups, cards, images, graphics, b-roll, openings or extras (the screen is the visual).
  // A YouTube video with a screen recording is directed like any other (screen + webcam picture-in-picture).
  const youtube = status.format === 'youtube'
  const screen = youtube ? null : status.screen ?? null
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
    const off = g.origin === 'auto' && decisions.motionGraphics === false
    return { ...rest, at, where: `on ${wordWhere(g.word)}`,
      problem: off ? 'Motion graphics is off in Skills, so this planned graphic won’t show.'
        : !registerKeeps(g, decisions.soundStyle) ? 'The Minimal style keeps only numbers, the hook and the call to action, so this planned graphic won’t show.'
        : at === null ? 'Its word is cut, so it won’t show. Keep the word or start it on another one.' : card ? 'It plays during a half-screen graphic, so it will be left out. Move it after that one, or turn it off.' : null }
  })
  /** A pop-up on this word would play during a graphic (it gives way to it). */
  const underGraphic = (word: number): boolean => {
    const at = starts.get(word)
    return at !== undefined && graphicItems.some((g) => !g.problem && g.at !== null && at < g.at + g.duration_ms / 1000 && at + 1.6 > g.at)
  }
  const setGraphics = (change: (list: EditGraphic[]) => EditGraphic[]): void => setDecisions((current) => ({ ...current, graphics: change(current.graphics ?? []) }))
  const addGraphic = (template: GraphicTemplateId, at: number, effectId?: string): string | null => {
    const word = wordAt(at)
    if (word === null) return null
    const line = lines.find((l) => l.words.includes(word))?.words.filter((i) => i >= word).map((i) => plan.words[i].text).join(' ')
    // An effect: the words said here for its fields, at its own length and size.
    const effect = template === 'fx' ? fxEffect(effectId) ?? FX_EFFECTS[0] : null
    const base = effect
      ? newGraphic('fx', 0, { fields: { effect: effect.id, ...prefillEffect(effect.id, [], 0, { line }).fields }, taken: graphics.map((g) => g.id), duration_ms: effect.default_ms, ...(effect.size ? { size: effect.size } : {}) })
      : newGraphic(template, 0, { fields: wordsAtPlayhead(template, line), taken: graphics.map((g) => g.id) })
    const graphic = newEditGraphic(base, word)
    setGraphics((list) => [...list, graphic].sort((a, b) => a.word - b.word))
    return graphic.id
  }
  const patchGraphic = (id: string, patch: ReelGraphicPatch): void => {
    const { at, ...rest } = patch
    const word = at === undefined ? undefined : wordAt(at) ?? undefined
    setGraphics((list) => patchEditGraphic(list, id, { ...rest, ...(word !== undefined ? { word } : {}) }))
  }

  // A pop-up that repeats what a graphic (or a half-screen graphic) shows at about the same time.
  const setPopupOn = (id: number, on: boolean): void => setDecisions((current) => ({ ...current, popups: current.popups.map((item) => item.id === id ? { ...item, on } : item) }))
  const cardPopups = plan.popups.filter((popup) => popup.kind === 'card')
  const textPopups = plan.popups.filter((popup) => popup.kind !== 'card')
  const shownExtras: DuplicateShown[] = [
    ...graphicItems.filter((g) => !g.problem && g.at !== null).map((g) => ({
      label: `the ${templateInfo(g.template).label.toLowerCase()} graphic ${g.where}`,
      texts: Object.entries(g.fields).filter(([key]) => !['color', 'shape', 'x', 'y', 'image'].includes(key)).map(([, value]) => value),
      start: g.at as number, end: (g.at as number) + g.duration_ms / 1000
    })),
    ...cardWindows.flatMap((w) => {
      const n = cardPopups.findIndex((p) => p.id === w.id)
      const popup = cardPopups[n]
      const card = decisions.popups.find((item) => item.id === w.id)?.card ?? popup?.card
      return popup && card ? [{ label: `half-screen graphic ${n + 1} on ${wordWhere(popup.word)}`, texts: [card.title, ...card.items], start: w.start, end: w.end }] : []
    })
  ]
  const duplicates = findDuplicateExtras(textPopups.flatMap((popup) => {
    const choice = decisions.popups.find((item) => item.id === popup.id)
    const at = starts.get(popup.word)
    return choice?.on && at !== undefined && !underGraphic(popup.word) ? [{ id: popup.id, text: choice.text || popup.text, at }] : []
  }), shownExtras)
  // The still next to the extras (and the frame to point on): the reel's first kept frame.
  const firstWord = useMemo(() => { const i = reelOrder(plan, decisions)[0]; return i === undefined ? null : plan.words[i] }, [plan, decisions])
  // Combine clips: the clips' 1080p proxies play here (a phone's 4K HEVC original may not).
  const media = (src: number | undefined): string | undefined => src === undefined ? undefined : sources[src]?.proxy ?? sources[src]?.path
  const stillVideo = firstWord ? media(firstWord.src) : media(decisions.clipOrder?.[0] ?? 0)
  const stillAt = firstWord ? firstWord.startMs / 1000 + 0.05 : 0.1

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
    // The card mentions the length only when it changed.
    const seconds = reelSeconds(plan, { ...chatState, ...patch })
    return { applied: { before }, length: Math.abs(seconds - reelSeconds(plan, chatState)) < 0.05 ? null : `Your reel is now about ${formatClock(seconds)} long.` }
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


  const scrollTo = (id: string): void => document.getElementById(id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  const openBeats = (): void => { setView('beats'); setOffer(false); requestAnimationFrame(() => scrollTo('edit-review-view')) }
  const saveBeatChoice = (choice: typeof beatChoice): void => { void useMemberPrefsStore.getState().saveApp({ beatSheet: choice }).catch((err: unknown) => onError(errorMessage(err))) }
  // "Make my reel": ask first, open the beat sheet, or make it (camera + screen reels have no beats to show).
  const makeOrAsk = (): void => {
    const next = screen || youtube ? 'render' : beforeRender(beatChoice, view === 'beats')
    if (next === 'ask') setOffer(true)
    else if (next === 'sheet') openBeats()
    else void make()
  }

  return (
    <Panel>
      <PanelHeader title="Review your edit" icon={<Wand2 className="h-4 w-4" />}
        description={`About ${formatClock(seconds)} long · ${cutCount} word${cutCount === 1 ? '' : 's'} cut${plan.combine ? ` · ${decisions.clipOrder?.length ?? sources.length} of ${sources.length} clips` : sources.length > 1 ? ` · from ${sources.length} takes` : ''}. Making the reel is free. Chat messages use your OpenRouter credit.`} />
      {(plan.notes.length > 0 || status.transcriber) && (
        <p className="mt-2 text-2xs text-ink-muted" data-testid="edit-notes">
          {[...plan.notes, status.transcriber === 'scribe' ? 'Transcribed with ElevenLabs Scribe v2.' : status.transcriber === 'standard' ? 'Transcribed with the usual transcription (Scribe wasn’t available).' : ''].filter(Boolean).join(' ')}
        </p>
      )}
      {status.warnings.map((warning) => <Callout key={warning} tone="warning" className="mt-3">{warning}</Callout>)}

      <EditLog className="mt-3" lines={logLines} disabled={making} defaultOpen={false}
        onRestore={(line) => { if (!line.restore) return; const { state, undo } = applyRestore(decisions, line.restore); setLastRestore(undo); setDecisions(state) }}
        onUndo={lastRestore ? () => { const back = undoRestore(decisions, lastRestore); if (back) setDecisions(back); setLastRestore(null) } : undefined} />

      {!screen && <div id="edit-review-view" className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Segmented label="Review view" value={view} onChange={setView}
          options={[{ value: 'edit', label: 'Your edit' }, { value: 'beats', label: <span className="inline-flex items-center gap-1.5"><LayoutGrid className="h-3.5 w-3.5" aria-hidden />Beat sheet</span> }]} />
        <span className="min-w-0 flex-1 text-2xs text-ink-subtle">{view === 'beats' ? 'Every on-screen moment as a numbered still. Give notes by number before your reel is made.' : 'See every planned on-screen moment as a numbered still in the beat sheet.'}</span>
      </div>}

      {!screen && <div className="mt-2 space-y-1.5" data-testid="edit-quick-controls">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" icon={<Sparkles className="h-3.5 w-3.5" />} disabled={making} onClick={() => applyDensity('dress')}
            title="Teaching style: more graphics on what you say, pop-ups and sound effects on. No AI call.">Dress it up</Button>
          <Button size="sm" variant="secondary" icon={<Eraser className="h-3.5 w-3.5" />} disabled={making} onClick={() => applyDensity('clean')}
            title="Keep only the hook, numbers, key diagrams and the call to action.">Keep it clean</Button>
          <label className="flex items-center gap-1.5 text-2xs text-ink-muted" htmlFor="edit-grade">Color
            <ColorGradePicker id="edit-grade" value={look.grade} disabled={making} onChange={(grade) => {
              const { grade: _old, ...rest } = look
              void _old
              onLook(grade === 'none' ? rest : { ...rest, grade })
            }} />
          </label>
          <Button size="sm" variant="ghost" icon={<BookmarkPlus className="h-3.5 w-3.5" />} disabled={making} onClick={saveMyLook}
            title="Your style, captions, hook text, grade, sound and transitions become the start of your next video.">Save as my look</Button>
        </div>
        {density && <p className="flex flex-wrap items-center gap-2 text-2xs text-ink-muted" data-testid="edit-density-note" role="status">
          <span>{densitySummary(density.change)}</span>
          {densityUndo && <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => { setDecisions(densityUndo); setDensity(null) }}>Undo</Button>}
        </p>}
        {look.grade && look.grade !== 'none' && <p className="text-2xs text-ink-subtle">{COLOR_GRADE_INFO[look.grade].detail} On your footage only: graphics, captions and text keep their colors.</p>}
        {lookSaved && <p className="text-2xs text-ink-muted" role="status" data-testid="edit-look-saved">{lookSaved}</p>}
      </div>}

      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(300px,340px)] xl:items-start xl:gap-5">
        {/* Chat: right under the header on narrow windows, a panel pinned to the side on wide ones. */}
        <section className="glass-tile mt-4 rounded-2xl p-3 xl:sticky xl:top-4 xl:col-start-2 xl:row-start-1 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto" aria-labelledby="edit-chat-title" data-testid="edit-chat">
          <h3 id="edit-chat-title" className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink"><MessageSquare className="h-4 w-4" aria-hidden />Chat</h3>
          <ChatPanel<EditChatStep, { before: EditChatPatch }>
            variant="review" threadKey={`edit\n${status.id}`} label="Chat about your edit"
            intro="Ask for a change in your own words, like “remove the second retake” or “add a stat graphic when I say 40%”. Each answer shows what changed, with Keep or Undo."
            placeholder="Ask for a change to your edit" suggestions={EDIT_CHAT_SUGGESTIONS}
            disabledReason={making ? 'Your reel is being made.' : null}
            loadInfo={typeof getApi().edit.chatInfo === 'function' ? () => getApi().edit.chatInfo() : undefined}
            ask={(message, points) => getApi().edit.chat(chatState, message, points)}
            point={{ suggestions: EDIT_CHAT_POINT_SUGGESTIONS, pad: <PointPad thread={`edit\n${status.id}`} video={stillVideo} seek={stillAt} /> }}
            parseSteps={parseEditChatSteps} isEdit={(step) => Object.keys(step.patch).length > 0}
            apply={applyChat}
            undo={(applied) => { applyPatch(applied.before); return null }}
            onReset={() => { void getApi().edit.chatReset?.().catch(() => {}) }}
            clearTooltip="Start a new chat about this edit. Your changes stay." />
        </section>

        <div className="min-w-0 xl:col-start-1 xl:row-start-1">
          {view === 'beats' && !screen && <BeatSheet runId={status.id} plan={plan} decisions={decisions} look={look} brand={brand} sources={sources} images={images}
            disabled={making} chatState={chatState} chatReady={chatReady} choice={beatChoice} onChoice={saveBeatChoice} onChange={setDecisions} />}
          <div className={cn(view === 'beats' && !screen && 'hidden')}>
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
            {plan.keptHook && (plan.keptHook.kept ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5" data-testid="edit-kept-headline">
                <p className="min-w-0 flex-1 text-2xs text-ink-muted">{decisions.hookText.trim() === plan.keptHook.text
                  ? 'Same headline as last time you made this video.'
                  : `Your last headline was “${plan.keptHook.text}”.`}</p>
                {plan.keptHook.fresh && plan.keptHook.fresh !== plan.keptHook.text && (decisions.hookText.trim() === plan.keptHook.text
                  ? <Button size="sm" variant="secondary" icon={<Sparkles className="h-3.5 w-3.5" />} onClick={() => setDecisions((current) => ({ ...current, hookText: plan.keptHook!.fresh }))}>New headline</Button>
                  : <Button size="sm" variant="ghost" onClick={() => setDecisions((current) => ({ ...current, hookText: plan.keptHook!.text }))}>Use my last headline</Button>)}
              </div>
            ) : (
              <p className="text-2xs text-ink-muted" data-testid="edit-kept-headline">Your last headline used words that aren’t in this recording, so the AI wrote a new one.</p>
            ))}
          </section>

          {plan.combine && decisions.clipOrder && (
            <ClipOrder plan={plan} sources={sources} order={decisions.clipOrder} transitions={decisions.transitions === true} disabled={making}
              onOrder={(clipOrder) => setDecisions((current) => ({ ...current, clipOrder }))}
              onTransitions={(transitions) => setDecisions((current) => ({ ...current, transitions }))} />
          )}

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
                    <p className="eyebrow mt-2 text-[10px] text-ink-subtle first:mt-0">
                      {plan.combine ? `Clip ${line.src + 1}${sources[line.src]?.shot ? ` (${SHOT_LABELS[sources[line.src].shot!].toLowerCase()})` : ''}${decisions.clipOrder && !decisions.clipOrder.includes(line.src) ? ' · left out' : ''}` : `Take ${line.src + 1}`} · {sources[line.src]?.name}
                    </p>
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
                            !isCut && inHook(i) && 'bg-tool/15 text-tool', !isCut && inCta(i) && 'underline decoration-tool decoration-2 underline-offset-4',
                            pinned && 'ring-1 ring-tool/70', pinning && 'cursor-copy')}>
                          {word.text}
                        </button>
                      )
                    })}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-1 text-2xs text-ink-subtle"><span className="text-tool">Highlighted</span>: plays first, as your hook.{plan.cta ? ' Underlined: your call to action, at the end.' : ''}</p>
          </section>

          {youtube && decisions.youtube && (
            <YoutubeChoicePanel value={decisions.youtube} pair={Boolean(status.screen)} disabled={making} onChange={(next) => setDecisions((current) => ({ ...current, youtube: next }))} />
          )}

          {screen && decisions.screen && (
            <ScreenChoicePanel value={decisions.screen} disabled={making} onChange={(next) => setDecisions((current) => ({ ...current, screen: next }))} />
          )}

          {plan.cta && (
            <SettingRow className="mt-4" title="End on your call to action" description={`“${spanText(plan.cta.start, plan.cta.end)}” moves to the end.`}
              control={<Switch label="End on your call to action" checked={decisions.endOnCta} onChange={(endOnCta) => setDecisions((current) => ({ ...current, endOnCta }))} />} />
          )}

          <SkillsPanel className="mt-5" rows={editSkillRows(plan, { ...decisions, look }, { brollSource: brollDefault }).filter((row) => !screen || (row.id !== 'broll' && row.id !== 'zoom'))}
            music={{ track: look.musicTrack ?? null, onChange: (track) => onLook({ ...look, musicTrack: track ?? undefined }) }}
            expand={(id) => id === 'broll' && look.broll ? <BrollSourcePicker value={look.broll} onChange={(broll) => onLook({ ...look, broll })} disabled={making} /> : undefined}
            onToggle={(id, on) => {
              const patch = editSkillPatch(plan, { ...decisions, look }, id, on, { brollSource: brollDefault })
              if (patch.decisions) { const next = patch.decisions; setDecisions((current) => ({ ...current, ...next })) }
              if (patch.look) onLook({ ...look, ...patch.look })
            }}
            onMore={(id) => id === 'captions' || id === 'zoom' ? () => { setLookOpen(true); requestAnimationFrame(() => scrollTo('edit-look')) }
              : id === 'sound_effects' ? () => scrollTo('edit-sounds-title')
                : id === 'rough_cut' ? () => scrollTo('edit-transcript-title') : undefined} />

          {!screen && !youtube && <EditStylePicker recipe={decisions.recipe} extras={decisions.lookExtras}
            onRecipe={(id) => { useEditRecordingStore.getState().setRecipe(id); setDecisions((current) => applyRecipe(plan, current, id)) }}
            onExtras={(lookExtras) => setDecisions((current) => ({ ...current, lookExtras }))} />}

          {!screen && <section className="mt-5 space-y-3" aria-labelledby="edit-extras-title" data-testid="edit-extras">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="edit-extras-title" className="flex items-center gap-1.5 text-sm font-semibold text-ink"><Layers className="h-4 w-4" aria-hidden />On-screen extras</h3>
                <Button size="sm" variant="secondary" icon={<LayoutGrid className="h-3.5 w-3.5" />} onClick={openBeats}>See the beat sheet</Button>
              </div>
              <p className="text-2xs text-ink-subtle">Everything that shows over your video: graphics, half-screen graphics, pop-ups and your own images. Each one starts as a word is said.</p>
            </div>
            {duplicates.map((dup) => (
              <Callout key={dup.popup} tone="warning" data-testid="edit-duplicate"
                action={<Button size="sm" variant="secondary" disabled={making} onClick={() => setPopupOn(dup.popup, false)}>Turn off the pop-up</Button>}>
                “{dup.text}” shows twice: as a pop-up and in {dup.other}, within a few seconds.
              </Callout>
            ))}
            <div className="grid gap-4 md:grid-cols-[112px_minmax(0,1fr)]">
              <figure className="hidden self-start md:sticky md:top-4 md:block" aria-label="Your reel’s first frame">
                <div className="chat-point-pad" style={{ width: 112 }}><VideoStill video={stillVideo} seek={stillAt} /></div>
                <figcaption className="mt-1 text-[10px] leading-tight text-ink-subtle">{firstWord ? `Opens on “${firstWord.text.replace(/[.,!?;:]+$/, '')}”` : 'Your reel'}</figcaption>
              </figure>
              <div className="min-w-0 space-y-5">
                <ReelGraphics label="Graphics" heading="h4" limit={MAX_EDIT_GRAPHICS}
                  intro={plan.graphics !== undefined ? 'Animated graphics planned for what you say: stats, lists, diagrams and more. After the reel is made, open it in the editor to move, change or add any of them, and to see them on the video.'
                    : 'Animated graphics over your reel: a stat that counts up, a title, a list and more. They stay clear of your hook text and captions, and can’t play during a half-screen graphic.'}
                  items={graphicItems} totalSeconds={reelLength} blocked={cardWindows.map((w) => ({ start: w.start, end: w.end, label: 'A half-screen graphic plays here' }))}
                  frame={graphicFrame} look={look.headlineLook} disabled={making} emptyNote={null}
                  onAdd={addGraphic} onPatch={patchGraphic} onRemove={(id) => setGraphics((list) => list.filter((g) => g.id !== id))}
                  cursorLabel={(at) => { const word = wordAt(at); return word === null ? 'at the start' : `on ${wordWhere(word)} (${formatClock(starts.get(word) ?? 0)})` }}
                  prefill={(template, at) => { const word = wordAt(at); return word === null ? {} : wordsAtPlayhead(template, lines.find((l) => l.words.includes(word))?.words.filter((i) => i >= word).map((i) => plan.words[i].text).join(' ')) }}
                  pictures={images.length ? { url: (id) => { const image = images.find((item) => item.id === id); return image ? localFileUrl(image.path) : undefined }, options: images.map((image) => ({ value: image.id, label: image.name })) } : undefined} />

                {cardPopups.length > 0 && (
                  <section className="space-y-2" aria-labelledby="edit-cards-title">
                    <div>
                      <h4 id="edit-cards-title" className="text-sm font-semibold text-ink">Half-screen graphics</h4>
                      <p className="text-2xs text-ink-subtle">A graphic fills the top half of the screen while you move to the bottom half.</p>
                    </div>
                    {cardPopups.map((popup, n) => {
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
                  </section>
                )}

                {textPopups.length > 0 && (
                  <section className="space-y-2" aria-labelledby="edit-popups-title">
                    <div>
                      <h4 id="edit-popups-title" className="text-sm font-semibold text-ink">Pop-ups</h4>
                      <p className="text-2xs text-ink-subtle">A short word or number that pops up as you say it.</p>
                    </div>
                    {textPopups.map((popup, n) => {
                      const choice = decisions.popups.find((item) => item.id === popup.id)
                      const removed = cut.has(popup.word)
                      return (
                        <div key={`p${popup.id}`} className="glass-tile flex items-center justify-between gap-3 rounded-xl px-3 py-2" data-testid={`edit-popup-${n}`}>
                          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="text-sm font-medium text-ink">Pop-up {n + 1}</span>
                            <TextInput aria-label={`Pop-up ${n + 1} text`} className="w-44" value={choice?.text ?? popup.text} maxLength={MAX_POPUP_TEXT_CHARS} disabled={!choice?.on || removed}
                              onChange={(e) => setDecisions((current) => ({ ...current, popups: current.popups.map((item) => item.id === popup.id ? { ...item, text: e.target.value } : item) }))} />
                            <span className="text-2xs text-ink-subtle">{removed ? 'Its word is cut, so it won’t show.' : underGraphic(popup.word) ? `A graphic plays when you say ${wordWhere(popup.word)}, so this pop-up won’t show.` : `Pops up when you say ${wordWhere(popup.word)}.`}</span>
                          </div>
                          <Switch label={`Pop-up ${n + 1}`} checked={Boolean(choice?.on) && !removed} disabled={removed} onChange={(on) => setPopupOn(popup.id, on)} />
                        </div>
                      )
                    })}
                  </section>
                )}

                <MyImages heading="h4" className="" images={images} pins={decisions.pins} wordText={wordWhere} pinning={pinning} onPinning={setPinning} onError={onError}
                  onImages={(next) => { setImages(next); setDecisions((current) => ({ ...current, pins: current.pins.filter((pin) => next.some((image) => image.id === pin.image)) })) }}
                  onUnpin={(gone) => setDecisions((current) => ({ ...current, pins: current.pins.filter((pin) => pin.image !== gone.image || pin.word !== gone.word) }))} />
              </div>
            </div>
          </section>}

          {!screen && (
            <section className="mt-5 space-y-2" aria-labelledby="edit-sounds-title" data-testid="edit-sounds">
              <h3 id="edit-sounds-title" className="text-sm font-semibold text-ink">Style and sound effects</h3>
              {/* One style for the graphics and the sound (register.ts). */}
              <SettingRow title="Style" description={`${REGISTER_INFO[decisions.soundStyle ?? DEFAULT_SOUND_REGISTER].detail}${plan.register && plan.graphics ? ` The graphics were planned as ${REGISTER_INFO[plan.register].label}.` : ''}`}
                  control={<Segmented size="sm" label="Style" value={decisions.soundStyle ?? DEFAULT_SOUND_REGISTER}
                    options={SOUND_REGISTERS.map((id) => ({ value: id, label: REGISTER_INFO[id].label }))}
                    onChange={(soundStyle) => setDecisions((current) => ({ ...current, soundStyle }))} />} />
              {soundEffectsOn(decisions) ? <>
                <p className="text-2xs text-ink-subtle">Each sound lands as its graphic or scene comes in. Your own sounds (Settings → My sounds) play first.</p>
                {plan.sounds.flatMap((sound) => sound.at === 'title' ? [] : [{ ...sound, at: sound.at }]).map((sound) => {
                  // The plan's extras (its hook-text sound is the hook's own now).
                  const choice = decisions.sounds.find((item) => item.id === sound.id)
                  const where = `on ${wordWhere(sound.at)}`
                  return (
                    <SettingRow key={`s${sound.id}`} title={`${SOUND_LABELS[sound.sound]} ${where}`} description={cut.has(sound.at) ? 'Its word is cut, so it won’t play.' : 'An extra the plan suggested. It plays only while a graphic is on screen.'}
                      control={<Switch label={`${SOUND_LABELS[sound.sound]} ${where}`} checked={Boolean(choice?.on)}
                        onChange={(on) => setDecisions((current) => ({ ...current, sounds: current.sounds.map((item) => item.id === sound.id ? { ...item, on } : item) }))} />} />
                  )
                })}
              </> : <p className="text-2xs text-ink-subtle">Sound effects are off. Turn them on in Skills above.</p>}
            </section>
          )}

          {!screen && <section className="mt-5 space-y-2" aria-labelledby="edit-openings-title">
            <h3 id="edit-openings-title" className="text-sm font-semibold text-ink">How it opens</h3>
            <SettingRow title="Cut-out opening" description={`For the first ${CUTOUT_INTRO_SECONDS} seconds your background is removed and you stand in front of a blurred collage of your images (or stills of your video).`}
              control={<Switch label="Cut-out opening" checked={decisions.cutoutIntro} onChange={(cutoutIntro) => setDecisions((current) => ({ ...current, cutoutIntro }))} />} />
            <SettingRow title="Raw-to-edited opening" description={`A ${RAW_INTRO_SECONDS}-second clip first shows your raw take, with the pauses and retakes that were cut marked in red, then your reel starts.`}
              control={<Switch label="Raw-to-edited opening" checked={decisions.rawIntro} onChange={(rawIntro) => setDecisions((current) => ({ ...current, rawIntro }))} />} />
          </section>}

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
                  rows={{ hooks: LOOK_HOOKS, handle: true, extras: !screen }} brand={brand} frame={previewFrame(media(decisions.clipOrder?.[0] ?? 0), 'video', 0.1)}
                  hookText={decisions.hookText} words={previewWords} skillExtras={['punch_zoom']} />
              </div>
            )}
          </section>
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" disabled={making} onClick={() => void getApi().edit.discard().catch((err: unknown) => onError(errorMessage(err)))}>Start over</Button>
        <div className="flex flex-wrap items-center gap-2">
          {view === 'beats' && !screen && <Button variant="ghost" disabled={making} onClick={() => setView('edit')}>Back to your edit</Button>}
          <Button variant="primary" size="lg" icon={<Clapperboard className="h-4 w-4" />} loading={making} disabled={making || problem !== null || seconds < 1.5 || cardTrouble}
            onClick={makeOrAsk}>{view === 'beats' && !screen ? 'Looks good, render' : youtube ? 'Make my YouTube video' : 'Make my reel'}</Button>
        </div>
      </div>
      {offer && <Dialog aria-label="See your beats first?" panelClassName="max-w-[460px]" onBackdropMouseDown={() => setOffer(false)}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setOffer(false) } }}>
        <div className="space-y-3 p-4">
          <div>
            <h2 className="text-sm font-semibold text-ink">See your beats first?</h2>
            <p className="mt-1 text-2xs text-ink-muted">The beat sheet shows every planned on-screen moment as a numbered still, with what you say there. Change any beat, then make your reel. It takes a few seconds.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-2xs text-ink-muted">Next time
            <Segmented size="sm" label="Next time" value={beatChoice} onChange={saveBeatChoice}
              options={[{ value: 'ask', label: 'Ask me' }, { value: 'always', label: 'Always show it' }, { value: 'skip', label: 'Skip it' }]} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => { setOffer(false); void make() }}>Render now</Button>
          <Button variant="primary" icon={<LayoutGrid className="h-4 w-4" />} autoFocus onClick={openBeats}>Show me the beat sheet</Button>
        </DialogFooter>
      </Dialog>}
    </Panel>
  )
}
