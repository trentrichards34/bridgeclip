import type { LogoSummary } from '../../shared/logos'
import { SavedStageTimings } from './StageBreakdown'
import { registerNavigationCommit } from '../lib/navigation'
import { nextCaptionRange } from '../lib/caption-ranges'
import { cloneElement, isValidElement, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Archive, Check, ChevronLeft, ChevronRight, ChevronDown, Copy, Download, Film, Loader2, Maximize2, Minimize2, Paintbrush, Pause, Pencil, Play, Plus, Redo2, RotateCcw, Scissors, SkipBack, Sparkles, Undo2, X } from 'lucide-react'
import { getApi } from '../lib/ipc'
import { cn, errorMessage, formatTimecode, localFileUrl, parseTimecode } from '../lib/utils'
import { HeadlineLookPicker } from './HeadlineLookPicker'
import { CtaPicker } from './CtaPicker'
import { Segmented } from './ui/Segmented'
import { DEFAULT_HEADLINE_LOOK, HEADLINE_FONTS, HIGHLIGHT, HIGHLIGHT_PHRASE_FAMILY, TEXT_BOX, headlineBarColor, headlineShownAt, headlineTextBg, headlineTextBox, headlineTextColor, highlightColors, highlightPlacement, textBoxOutline, textBoxPath, textBoxRects } from '../../shared/headline-look'
import { captionLanguageLabel } from '../../shared/caption-language'
import { type AutomaticOmission, MAX_EDITOR_CANDIDATES, TRANSCRIPT_CLIP_MS, applyStyleToAll, runHookLook, transcriptClip, transcriptRange, variantOf, type HookIdea, MAX_HOOK_CHARS, SPLIT_RANGE, panelRows, resizeSplit, splitOf, EDITOR_REVISION_CONFLICT, cameraMarkers, snapFrame, stepFrame, candidateEdit, canAnimateScene, defaultCrop, editDuration, editSignature, editorProgress, framingAt, outputTimeAt, normalizeSceneTransitions, refineEdit, renderEditKey, resizeCrop, retimeScene, sceneAt, trimRange, type CandidateEdit, type Crop, type CropCorner, type EditorCandidate, type EditorQuestion, type EditorRange, type EditorScene, type EditorSession } from '../../shared/clip-editor'
import { CameraChanges, CameraScanButton } from './CameraChanges'
import { ActionMenu } from './ui/ActionMenu'
import { Button } from './ui/Button'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { CaptionPresetPicker } from './CaptionPresetPicker'
import { EditorLookExtras } from './EditorLookExtras'
import { EditorSoundDesign } from './EditorSoundDesign'
import { ColorGradePicker } from './ColorGradePicker'
import { COLOR_GRADE_INFO, gradePreviewFilter } from '../../shared/color-grade'
import { EditorCaptionPreview } from './EditorCaptionPreview'
import { captionAnchor } from '../lib/caption-preview'
import { Switch } from './ui/Switch'
import { Select } from './ui/Select'
import { EditInspector } from './EditInspector'
import { ClipChat, clipChatThread, type ChatApplied, type ChatApplyResult } from './ClipChat'
import { PointButton, PointLayer } from './ChatPoints'
import { GraphicsInspector, GraphicsOverlay, GraphicsTrack, draftGraphic, useClipWords } from './ClipGraphics'
import { GraphicGallery } from './GraphicGallery'
import { fxEffect, fxPictureFields } from '../../shared/fx-catalog'
import { GraphicPreviewEditor } from './GraphicPreviewEditor'
import { ScenesOverlay, ScenesTrack } from './ClipScenes'
import { ZoomsTrack } from './ClipZooms'
import { drawZoom } from './zoom-preview'
import { GRAPHIC_TEMPLATES, graphicsCap, duplicateGraphic, fitGraphicInCut, graphicLocalMs, hookEndMs, nearestOutputTime, outputTime, placeInFreeBand, removeGraphic, withGraphic, type EditorGraphic, type GraphicTemplateId } from '../../shared/motion-graphics'
import { stageHookEndMs } from '../../shared/scenes'
import { graphicStyle } from '../../shared/graphic-layout'
import { prefillEffect, prefillGraphic } from '../../shared/graphic-prefill'
import { EditLog } from './EditLog'
import { ScreenLayoutRow } from './ScreenLayouts'
import { SCREEN_KIND_LABELS, bubbleRect, screenKindOf, screenScene, screenShareOf, type ScreenKind } from '../../shared/screen-pair'
import { EditorTabs, type EditorTab } from './EditorTabs'
import { clipEditLog } from '../../shared/edit-log'
import { clipLengthNote, mergeChatSteps, patchValues, type ChatPatch, type ChatStep } from '../../shared/clip-chat'

const labels: Record<string, string> = { not_sponsored: 'Not sponsored', opening_context: 'Opening context', self_contained: 'Self contained', complete_ending: 'Complete ending', logical_flow: 'Logical flow', faithful_to_source: 'Faithful to source', title_supported: 'Title supported', evidence: 'Enough evidence', removal_safe: 'Safe to remove', join_logical: 'Natural join' }
const clock = (n: number): string => `${formatTimecode(n)}.${String(Math.floor(n % 1000)).padStart(3, '0')}`
const cropCorners: CropCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
const statusLabels = { refining: 'Refining', ready: 'Ready', baked: 'Baked', discarded: 'Discarded' }
const layoutNames: Record<EditorScene['layout'], string> = { fill: 'Full frame', split: 'Split', fit: 'Fit', inset: 'Screen', bubble: 'Screen + bubble' }
const hookTypeLabels: Record<string, string> = { direct_response: 'Result', story: 'Story', challenge: 'Challenge', educational: 'Teaching', contrarian: 'Contrarian', vulnerability: 'Vulnerable', none: 'Plain' }
const formatBytes = (n: number): string => n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`
const reviewCurrent = (c: EditorCandidate): boolean => {
  try { return JSON.stringify(JSON.parse(c.review?.signature ?? 'null')) === editSignature(c) } catch { return false }
}
function Question({ q }: { q: EditorQuestion }): React.JSX.Element {
  const passed = q.probability !== null && q.probability >= q.threshold
  const words = (text: string): string => text.replaceAll('`retained_dialogue`', 'this clip').replaceAll('`before`', 'the preceding context').replaceAll('`after`', 'the following context').replaceAll('`title`', 'the title').replaceAll('`visual_observations`', 'visual evidence')
  return <details className="editor-question">
    <summary><span className={cn('editor-dot', passed ? 'bg-success' : 'bg-warning')} /><span className="min-w-0 flex-1 truncate">{labels[q.id] ?? q.id}</span>
      <span aria-hidden className={cn('editor-question-bar', passed ? 'passed' : 'consider')}>{q.probability !== null && <span style={{ width: `${Math.round(q.probability * 100)}%` }} />}<i style={{ left: `${Math.round(q.threshold * 100)}%` }} /></span>
      <span className={cn('min-w-[40px] whitespace-nowrap text-right font-mono text-xs', passed ? 'text-success' : 'text-warning')}>{q.probability === null ? 'Not rated' : `${Math.round(q.probability * 100)}%`}</span><ChevronDown size={12} /></summary>
    <p>{words(q.prompt)}</p><p className="text-ink-subtle">{q.probability === null ? `Review ${q.status.replaceAll('_', ' ')}. ` : ''}Target: {Math.round(q.threshold * 100)}%</p>
    <p><span className="text-success">Pass: </span>{q.yes}</p><p><span className="text-warning">Consider: </span>{q.no}</p>
  </details>
}

/** What a re-baked Automatic clip leaves out, in words. */
const omissionLabels: Record<AutomaticOmission, string> = { broll: 'B-roll', hook_preview: 'hook preview', background: 'background video', title_card: 'title card' }
function listWords(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`
}

export function ClipEditor({ outputDir, leading, onExports, initialClip, initialCandidate, initialTab, onNeedSource }: {
  outputDir: string; leading?: ReactNode; onExports: () => Promise<void>
  /** Library clip to select first (its candidate), and the inspector tab to show. */
  initialClip?: number; initialTab?: 'hook'
  /** Editor clip (candidate index) to select first, from the Library's clip view. */
  initialCandidate?: number
  /** A project made from an Automatic run lost its video: get it again (download or the original file). */
  onNeedSource?: () => void
}): React.JSX.Element {
  const [session, setSession] = useState<EditorSession | null>(null)
  const [edits, setEdits] = useState<EditorCandidate[]>([])
  const editsRef = useRef(edits); editsRef.current = edits
  const sessionRef = useRef(session); sessionRef.current = session
  /** Most graphics a clip of this project may have (a YouTube video's grows with its length). */
  const graphicCap = graphicsCap(session?.project)
  const savedKey = useRef('')
  const savePromise = useRef<Promise<void> | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A stale-revision save can never succeed; offer a reload instead of a retry loop.
  const [conflict, setConflict] = useState(false)
  const [confirmFree, setConfirmFree] = useState(false)
  const closeFree = useCallback(() => setConfirmFree(false), [])
  /** Render identity of each clip when it left Baked, so undo can restore Baked. */
  const bakedKeys = useRef(new Map<string, string>())
  const [busy, setBusy] = useState<EditorSession['operation']>(null)
  const [batch, setBatch] = useState<EditorSession['batch']>()
  const [progress, setProgress] = useState<EditorSession['progress']>()
  const [notice, setNotice] = useState<string | null>(null)
  const [replacement, setReplacement] = useState<string | null>(null)
  const closeReplacement = useCallback(() => setReplacement(null), [])
  const [selected, setSelected] = useState(0)
  const [tab, setTab] = useState<EditorTab>('review')
  // Big preview: a tall Output monitor over a compact timeline (Cuts, Layouts, Graphics, Scenes). On by itself while the
  // Graphics tab is open; the monitor header's button turns it on or off for any tab (null: follow the tab).
  const [bigChoice, setBigChoice] = useState<boolean | null>(null)
  const bigPreview = bigChoice ?? tab === 'graphics'
  // "Choose" picked but no call to action chosen yet (the clip still uses the run's until one is).
  const [ctaPicking, setCtaPicking] = useState(false)
  useEffect(() => setCtaPicking(false), [selected])
  // Motion graphics: the one selected (on the preview, the Graphics row or tab), and the gallery's spot (source ms) while it is open.
  const [graphicId, setGraphicId] = useState<string | null>(null)
  const [gallery, setGallery] = useState<number | null>(null)
  useEffect(() => { setGraphicId(null); setGallery(null) }, [selected])
  // "Suggest graphics for this clip": a fixed message the Chat tab sends once it is open.
  const [chatAuto, setChatAuto] = useState<{ id: number; text: string } | null>(null)
  const [time, setTime] = useState(0)
  const timeRef = useRef(time); timeRef.current = time
  const [playing, setPlaying] = useState(false)
  const [reviewSpeed, setReviewSpeed] = useState(1)
  const [previewCut, setPreviewCut] = useState(true)
  const [showSubtitlePreview, setShowSubtitlePreview] = useState(true)
  const [cameraThreshold, setCameraThreshold] = useState(.08)
  const [selectedCamera, setSelectedCamera] = useState<number | null>(null)
  const deselectCamera = useCallback(() => setSelectedCamera(null), [])
  const [timelineZoom, setTimelineZoom] = useState<'clip' | 'source' | [number, number]>('clip')
  const zoomWindow = Array.isArray(timelineZoom) ? timelineZoom : null
  const presentedTime = useRef<number | null>(null)
  const [cropDragging, setCropDragging] = useState(false)
  const dragging = useRef(false)
  const editorRoot = useRef<HTMLElement>(null)
  const [dragWindow, setDragWindow] = useState<[number, number] | null>(null)
  const previewCutRef = useRef(previewCut); previewCutRef.current = previewCut
  const [panel, setPanel] = useState(0)
  const [showAudit, setShowAudit] = useState(false)
  // "Use this style on every clip": how many clips would change, while asking.
  const [confirmStyle, setConfirmStyle] = useState<number | null>(null)
  const closeStyle = useCallback(() => setConfirmStyle(null), [])
  // Transcript lines picked for "Make a clip from these lines" (indices into the transcript).
  const [lines, setLines] = useState<{ anchor: number; first: number; last: number } | null>(null)
  const lineDrag = useRef(false)
  useEffect(() => {
    const end = (): void => { lineDrag.current = false }
    window.addEventListener('pointerup', end)
    return () => window.removeEventListener('pointerup', end)
  }, [])
  const [hookIdeas, setHookIdeas] = useState<{ id: string; hooks: HookIdea[] } | null>(null)
  const [undo, setUndo] = useState<EditorCandidate[][]>([])
  const [redo, setRedo] = useState<EditorCandidate[][]>([])
  const [editingCaption, setEditingCaption] = useState<number | null>(null)
  // A chat answer playing a moment: when it stops, and whether "Play cuts only" goes back on.
  const chatPlay = useRef<{ timer: number; restoreCut: boolean } | null>(null)
  useEffect(() => () => { if (chatPlay.current) window.clearTimeout(chatPlay.current.timer) }, [])
  const firstCaptionChange = useRef(true)
  const captionInput = useRef<HTMLTextAreaElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const transcriptPanel = useRef<HTMLDivElement>(null)
  const activeCaption = useRef<HTMLDivElement>(null)
  const activeTranscript = session?.project.transcript.find((r) => time >= r.start_ms && time < r.end_ms)
  const candidate = edits[selected]
  const candidateRef = useRef(candidate); candidateRef.current = candidate
  // The transcript's timed words around the clip: new graphics start with the words said where they go.
  const clipWords = useClipWords(outputDir, candidate?.ranges[0][0] ?? 0, candidate?.ranges[candidate.ranges.length - 1][1] ?? 0)
  const frames = candidate?.camera_scan?.frames ?? []
  const currentScene = candidate ? sceneAt(candidate, time) : null
  const key = JSON.stringify(edits.map(candidateEdit))
  const keyRef = useRef(key); keyRef.current = key
  const load = useCallback(async () => {
    try {
      const s = await getApi().editor.open(outputDir)
      if (!sessionRef.current) {
        const fromClip = initialCandidate !== undefined && initialCandidate >= 0 && initialCandidate < s.project.candidates.length ? initialCandidate
          : initialClip === undefined ? -1 : s.project.candidates.findIndex((c) => c.library_clip === initialClip || c.exports.includes(initialClip))
        setSelected(fromClip >= 0 ? fromClip : editorProgress(s.project.candidates).initialCandidate)
        if (initialTab) setTab(initialTab)
      }
      setSession(s); sessionRef.current = s; setEdits(s.project.candidates); editsRef.current = s.project.candidates
      savedKey.current = JSON.stringify(s.project.candidates.map(candidateEdit))
      keyRef.current = savedKey.current
      setBusy(s.operation ?? null); setBatch(s.batch); setProgress(s.progress); setError(null); setConflict(false)
    } catch (e) { setError(errorMessage(e)) }
  }, [outputDir, initialClip, initialCandidate, initialTab])
  useEffect(() => { void load() }, [load])
  const [originNote, setOriginNote] = useState(true)
  // A reopened window can reconnect to an export/review still owned by main.
  // Poll only progress; reload the project once that operation ends.
  useEffect(() => {
    if (!session?.operation) return
    let pending = false
    const timer = window.setInterval(() => {
      if (pending) return
      pending = true
      void getApi().editor.progress(outputDir).then((p) => {
        if (!p.operation) return load()
        setBatch(p.batch); setProgress(p.progress)
      }).catch(() => {}).finally(() => { pending = false })
    }, 1500)
    return () => window.clearInterval(timer)
  }, [session?.operation, load, outputDir])

  const save = useCallback(async (): Promise<void> => {
    if (savePromise.current) await savePromise.current
    if (!sessionRef.current || keyRef.current === savedKey.current) return
    const task = async (): Promise<void> => {
      setSaving(true)
      try {
        while (keyRef.current !== savedKey.current) {
          const sentKey = keyRef.current
          const s = await getApi().editor.save(outputDir, sessionRef.current!.project.revision, editsRef.current)
          savedKey.current = sentKey; sessionRef.current = s; setSession(s)
        }
      } catch (e) {
        if (errorMessage(e).includes(EDITOR_REVISION_CONFLICT)) setConflict(true)
        throw e
      } finally { setSaving(false); savePromise.current = null }
    }
    savePromise.current = task()
    await savePromise.current
  }, [outputDir])
  useEffect(() => {
    if (!session || busy || dragWindow || cropDragging || key === savedKey.current) return
    const timer = window.setTimeout(() => { void save().catch((e) => setError(errorMessage(e))) }, 700)
    return () => window.clearTimeout(timer)
  }, [key, session, busy, dragWindow, cropDragging, save])
  useEffect(() => registerNavigationCommit(async () => {
    try { await save() } catch (e) { setError(errorMessage(e)); throw e }
  }), [save])
  // Flush in-memory edits on page navigation; main owns the durable write.
  useEffect(() => () => { void save().catch(() => {}) }, [save])
  // Unsaved edits block unload; main then asks Save / Discard / Cancel and,
  // for Save, asks this editor to save before it continues the close.
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent): void => { if (keyRef.current !== savedKey.current) event.preventDefault() }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [])
  useEffect(() => getApi().editor.onSaveBeforeClose?.(() => {
    void save().then(() => getApi().editor.closeReady(true), (e) => {
      setError(errorMessage(e))
      return getApi().editor.closeReady(false)
    }).catch(() => {})
  }), [save])

  const change = (patch: Partial<CandidateEdit>, remember = true): void => {
    if (busy || !candidate || (candidate.status === 'discarded' && patch.status === undefined)) return
    if (patch.scenes) patch = { ...patch, scenes: normalizeSceneTransitions(patch.scenes) }
    if (candidate.status === 'baked') bakedKeys.current.set(candidate.id, renderEditKey(candidate))
    if (remember) { setUndo((u) => [...u.slice(-49), edits]); setRedo([]) }
    setEdits((items) => items.map((c, i) => i === selected ? refineEdit(c, patch) : c))
  }
  const history = (direction: 'undo' | 'redo'): void => {
    const from = direction === 'undo' ? undo : redo
    if (busy || !from.length) return
    // Undo can restore an old edit, but only a completed render creates Baked:
    // the exact render a clip left (main checks the same identity on save).
    const next = from[from.length - 1].map((c, i) => c.status === 'baked' && edits[i].status !== 'baked' &&
      bakedKeys.current.get(c.id) !== renderEditKey(c) ? { ...c, status: 'refining' as const } : c)
    setEditingCaption(null)
    if (direction === 'undo') { setUndo(from.slice(0, -1)); setRedo((r) => [...r, edits]) }
    else { setRedo(from.slice(0, -1)); setUndo((u) => [...u, edits]) }
    setEdits(next)
  }
  /** Open the graphics gallery: a new graphic goes at `at` (source ms, the playhead unless the row was clicked elsewhere). */
  const openGallery = (at: number): void => {
    if (!candidate || (candidate.graphics?.length ?? 0) >= graphicCap) { if (candidate) { setTab('graphics') } return }
    video.current?.pause(); setGallery(at)
  }
  // A graphic just selected is shown on the preview once it is in the clip (the next render, after its edit).
  const showPending = useRef<string | null>(null)
  useEffect(() => {
    const id = showPending.current, g = id ? candidate?.graphics?.find((x) => x.id === id) : null
    if (!g) return
    showPending.current = null
    showGraphic(g)
  })
  /** Shows a graphic on the preview: the playhead moves into it when it is outside (a little in, once it has come in). */
  const showGraphic = (g: EditorGraphic): void => {
    if (!candidate) return
    const local = graphicLocalMs(candidate, g, timeRef.current)
    if (local === null || local < 250) seek(g.at_ms + Math.min(900, g.duration_ms * .4))
  }
  const duplicateSelectedGraphic = (): void => {
    const g = candidate?.graphics?.find((x) => x.id === graphicId)
    if (!candidate || !g || candidate.graphics!.length >= graphicCap || candidate.status === 'discarded') return
    const ids = candidate.graphics!.map((x) => x.id)
    const after = fitGraphicInCut(duplicateGraphic(g, ids), candidate)
    const copy = after && after.at_ms >= g.at_ms + g.duration_ms - 50 ? after : placeInFreeBand(candidate.graphics!, duplicateGraphic(g, ids, g.at_ms))
    change({ graphics: withGraphic(candidate, copy, graphicCap) }); setGraphicId(copy.id); showGraphic(copy)
  }
  const seek = (t: number): void => {
    if (!video.current || !session) return
    const value = Math.max(0, Math.min(session.project.duration_ms - 1, t))
    presentedTime.current = null
    timeRef.current = value
    video.current.currentTime = value / 1000 + (frames.length ? .000001 : 0); setTime(value)
  }
  const frameStep = (direction: -1 | 1, count = 1): void => {
    video.current?.pause()
    let next = timeRef.current
    for (let i = 0; i < count; i++) next = stepFrame(frames, next, direction)
    seek(next)
  }
  const scrub = (direction: -1 | 1, coarse: boolean): void => {
    video.current?.pause()
    if (coarse) seek(timeRef.current + direction * 1000)
    else frameStep(direction, Math.round(reviewSpeed))
  }
  const toggle = (): void => {
    const v = video.current
    if (!v || !candidate) return
    if (!v.paused) {
      v.pause(); setPlaying(false)
      const panel = transcriptPanel.current
      if (panel) panel.scrollTo({ top: panel.scrollTop, behavior: 'instant' })
      return
    }
    if (previewCut && !candidate.ranges.some(([a, b]) => a <= v.currentTime * 1000 && b > v.currentTime * 1000)) seek(candidate.ranges[0][0])
    void v.play().catch(() => setError('The source preview could not play. Try seeking or reopening the editor.'))
  }
  const trim = (edge: 'in' | 'out', t: number): void => {
    if (!candidate) return
    change({ ranges: trimRange(candidate.ranges, edge === 'in' ? 0 : candidate.ranges.length - 1, edge === 'in' ? 0 : 1, t, session!.project.duration_ms) })
  }
  const split = (): void => {
    if (!candidate) return
    const t = Math.round(time)
    const ranges = candidate.ranges.flatMap(([a, b]): [number, number][] => t > a + 100 && t < b - 100 ? [[a, t], [t, b]] : [[a, b]])
    if (ranges.length <= 24) change({ ranges })
  }
  useEffect(() => {
    const playbackKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      const speedKey = !e.shiftKey && /^[123]$/.test(e.key)
      const timelineArrow = (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && target.matches('.editor-source-scrub,.editor-fine-scrub')
      // Range inputs otherwise use a browser-defined percentage of their span,
      // making arrow jumps depend on focus and timeline zoom.
      if (timelineArrow) e.preventDefault()
      if ((e.code !== 'Space' && !speedKey && !timelineArrow) || e.metaKey || e.ctrlKey || e.altKey || e.isComposing || showAudit || replacement || busy) return
      if ((!editorRoot.current?.contains(target) && target !== document.body) ||
          target.closest('[role="dialog"],[role="combobox"],[role="listbox"],[role="menu"],[aria-haspopup="menu"],[aria-haspopup="dialog"],input:not([type="range"]),textarea,select,[contenteditable]:not([contenteditable="false"])')) return
      // Own Space before focused buttons/markers can activate or seek on it.
      // A held key must not repeatedly pause and restart playback.
      e.preventDefault(); e.stopPropagation()
      if (dragging.current) return
      if (timelineArrow) scrub(e.key === 'ArrowLeft' ? -1 : 1, e.shiftKey)
      else if (!e.repeat) {
        if (speedKey) setReviewSpeed(Number(e.key))
        else toggle()
      }
    }
    const handler = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement).closest('[role="dialog"],[role="combobox"],[role="listbox"],[role="menu"],[aria-haspopup="menu"],input,textarea,select,[contenteditable]') || showAudit || replacement || dragging.current) return
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); history(e.shiftKey ? 'redo' : 'undo'); return }
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); void save(); return }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd' && graphicId && !busy) { e.preventDefault(); duplicateSelectedGraphic(); return }
      if (e.metaKey || e.ctrlKey || e.altKey || busy) return
      // Graphics: G opens the gallery at the playhead; Delete removes the selected graphic.
      if (e.key.toLowerCase() === 'g' && candidate && candidate.status !== 'discarded') { e.preventDefault(); openGallery(time); return }
      if ((e.key === 'Delete' || e.key === 'Backspace') && graphicId && candidate?.graphics?.some((g) => g.id === graphicId) && candidate.status !== 'discarded') { e.preventDefault(); change({ graphics: removeGraphic(candidate, graphicId) }); setGraphicId(null); return }
      if (e.key.toLowerCase() === 'i') trim('in', time)
      if (e.key.toLowerCase() === 'o') trim('out', time)
      if (e.key.toLowerCase() === 's') split()
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); scrub(e.key === 'ArrowLeft' ? -1 : 1, e.shiftKey) }
    }
    window.addEventListener('keydown', playbackKey, true)
    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', playbackKey, true)
      window.removeEventListener('keydown', handler)
    }
  })
  useEffect(() => {
    if (candidate && video.current) { video.current.pause(); seek(candidate.ranges[0][0]); setPanel(0); setEditingCaption(null); setSelectedCamera(null); setTimelineZoom((zoom) => zoom === 'source' ? 'source' : 'clip') }
  // Only candidate selection resets the playhead, never an edit.
  }, [selected, session?.previewPath])
  useEffect(() => { if (video.current && candidate) video.current.playbackRate = candidate.video_speed * reviewSpeed }, [candidate?.video_speed, reviewSpeed])
  useEffect(() => {
    if (tab !== 'transcript' || !playing || video.current?.paused || showAudit || editingCaption !== null || !activeTranscript) return
    const panel = transcriptPanel.current, caption = activeCaption.current
    if (!panel || !caption) return
    const bounds = panel.getBoundingClientRect(), row = caption.getBoundingClientRect()
    if (row.top >= bounds.top + 12 && row.bottom <= bounds.bottom - 12) return
    // Scroll only the inspector, leaving the video and timeline in place.
    const inset = Math.max(12, (panel.clientHeight - row.height) / 2)
    panel.scrollTo({ top: panel.scrollTop + row.top - bounds.top - inset,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    return () => { panel.scrollTo({ top: panel.scrollTop, behavior: 'instant' }) }
  }, [activeTranscript, playing, tab, selected, showAudit, editingCaption])
  useEffect(() => {
    if (editingCaption === null || tab !== 'transcript' || !captionInput.current || !transcriptPanel.current) return
    const input = captionInput.current, panel = transcriptPanel.current
    input.focus({ preventScroll: true })
    panel.scrollTo({ top: panel.scrollTop + input.getBoundingClientRect().top - panel.getBoundingClientRect().top - 36, behavior: 'instant' })
  }, [editingCaption, tab])
  useEffect(() => {
    const v = video.current
    if (!v) return
    let callback = 0
    const presented: VideoFrameRequestCallback = (_, metadata) => {
      const sourceFrames = candidateRef.current?.camera_scan?.frames ?? []
      const t = snapFrame(sourceFrames, Math.round(metadata.mediaTime * 1000000) / 1000)
      presentedTime.current = t
      if (!v.seeking && !v.paused) setTime(t)
      callback = v.requestVideoFrameCallback(presented)
    }
    callback = v.requestVideoFrameCallback(presented)
    return () => v.cancelVideoFrameCallback(callback)
  }, [session?.previewPath])
  useEffect(() => {
    let frame = 0
    const draw = (): void => {
      const v = video.current, out = canvas.current, c = candidateRef.current
      if (v && out && c && v.readyState >= 2 && !v.seeking) {
        // A paused seek can decode the frame just before a layout boundary.
        // Keep the preview on the same selected time as the crop controls;
        // during playback, follow the actual presented frame for cut accuracy.
        let t = v.paused ? timeRef.current : presentedTime.current ?? v.currentTime * 1000
        if (!v.paused && previewCutRef.current) {
          const clockTime = v.currentTime * 1000
          const range = c.ranges.find(([, end]) => end > clockTime)
          if (!range) { v.pause(); t = c.ranges.at(-1)![1]; v.currentTime = t / 1000; presentedTime.current = null; setTime(t) }
          else if (clockTime < range[0]) { t = range[0]; v.currentTime = t / 1000; presentedTime.current = null }
        }
        const scene = framingAt(c, t), ctx = out.getContext('2d')!
        ctx.clearRect(0, 0, out.width, out.height)
        const hookLayout = previewHook(ctx, c, out.width, out.height)
        if (scene.layout === 'fit') {
          ctx.filter = 'blur(16px) brightness(.75)'; ctx.drawImage(v, 0, 0, out.width, out.height); ctx.filter = 'none'
          const scale = Math.min(out.width / v.videoWidth, out.height / v.videoHeight)
          const w = v.videoWidth * scale, h = v.videoHeight * scale
          ctx.drawImage(v, (out.width - w) / 2, (out.height - h) / 2, w, h)
        } else if (scene.layout === 'inset' || scene.layout === 'bubble') {
          // Camera + screen: the screen fitted over a blurred copy of itself (and the face in a round bubble), as the export draws it.
          const [x, y, w, h] = scene.crops[0], sx = x * v.videoWidth, sy = y * v.videoHeight, sw = w * v.videoWidth, sh = h * v.videoHeight
          const cover = Math.max(out.width / sw, out.height / sh)
          ctx.filter = 'blur(16px) brightness(.75)'
          ctx.drawImage(v, sx + (sw - out.width / cover) / 2, sy + (sh - out.height / cover) / 2, out.width / cover, out.height / cover, 0, 0, out.width, out.height)
          ctx.filter = 'none'
          const spot = bubbleRect(scene.crops[0], { width: v.videoWidth, height: v.videoHeight }, { width: out.width, height: out.height })
          ctx.drawImage(v, sx, sy, sw, sh, spot.inset.x, spot.inset.y, spot.inset.w, spot.inset.h)
          if (scene.layout === 'bubble') {
            const [fx, fy, fw, fh] = scene.crops[1], side = Math.min(fw * v.videoWidth, fh * v.videoHeight)
            const cx = fx * v.videoWidth + (fw * v.videoWidth - side) / 2, cy = fy * v.videoHeight + (fh * v.videoHeight - side) / 2
            const ring = spot.d * 8 / 368
            ctx.save(); ctx.beginPath(); ctx.arc(spot.x + spot.d / 2, spot.y + spot.d / 2, spot.d / 2 + ring, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill()
            ctx.beginPath(); ctx.arc(spot.x + spot.d / 2, spot.y + spot.d / 2, spot.d / 2, 0, Math.PI * 2); ctx.clip()
            ctx.drawImage(v, cx, cy, side, side, spot.x, spot.y, spot.d, spot.d); ctx.restore()
          }
        } else {
          // A hook bar takes the top of the frame and the video fills the rest (trimmed around its center, as the export does).
          const barH = hookLayout ? hookLayout.barH : 0, area = out.height - barH
          const rows = panelRows(scene)
          scene.crops.forEach(([x, y, w, h], i) => {
            let sw = w * v.videoWidth, sh = h * v.videoHeight
            const dh = rows[i][1] * area, target = out.width / dh
            let sx = x * v.videoWidth, sy = y * v.videoHeight
            if (barH && sw / sh < target) { const trimmed = sw / target; sy += (sh - trimmed) / 2; sh = trimmed }
            else if (barH && sw / sh > target) { const trimmed = sh * target; sx += (sw - trimmed) / 2; sw = trimmed }
            ctx.drawImage(v, sx, sy, sw, sh, 0, barH + rows[i][0] * area, out.width, dh)
            // Screen zooms, as the bake makes them (approximate: the preview video is smaller).
            const zoomArea = sessionRef.current?.project.zoom
            if (zoomArea && c.zooms?.length) drawZoom(ctx, v, c.zooms, zoomArea, t, { sx, sy, sw, sh, dx: 0, dy: barH + rows[i][0] * area, dw: out.width, dh })
          })
        }
        // Hook text preview (vertical clips): the bar or floating text at the top.
        const hook = c.hook
        if (hook && hookLayout) {
          const { bar, size } = hookLayout
          ctx.font = `800 ${size}px ${hookLayout.family}`
          if (bar) { ctx.fillStyle = bar; ctx.fillRect(0, 0, out.width, hookLayout.barH) }
        }
        // "Hide hook text": past its time in the exported clip, the text is gone (a bar stays as a plain band).
        // The hook hands over to the first chapter header: gone once it starts.
        // And it fades out as the first stage scene starts (the stage's graphics take the top).
        const handOver = [hookEndMs(c), stageHookEndMs(c)].reduce<number | null>((min, v) => v === null ? min : min === null ? v : Math.min(min, v), null)
        if (hook && hookLayout && headlineShownAt(hook.look, outputTimeAt(c, t) / 1000) && (handOver === null || outputTimeAt(c, t) < handOver)) {
          const { bar, size, lines: shown, top, lineH } = hookLayout
          ctx.textAlign = 'center'; ctx.textBaseline = 'top'
          const box = bar ? null : headlineTextBox(hook.look)
          if (headlineTextBg(hook.look) === 'highlight') {
            // Key words in color: the lead words on a white box, the key words in italic on a box in the color (as the export).
            const font = HEADLINE_FONTS.find((f) => f.id === hook.look.font) ?? HEADLINE_FONTS[0]
            const css = (px: number, phrase: boolean): string => phrase ? `italic 400 ${px * HIGHLIGHT.phraseScale}px ${HIGHLIGHT_PHRASE_FAMILY}` : `${font.weight ?? 400} ${px * (font.scale ?? 1)}px ${font.family}`
            const measure = (line: string, px: number, phrase: boolean): number => { ctx.font = css(px, phrase); return ctx.measureText(line).width }
            const text = font.upper ? hook.text.toUpperCase() : hook.text
            const placed = highlightPlacement(text, measure, out.width, out.height, out.height / 1920)
            const colors = highlightColors(hook.look)
            ctx.fillStyle = colors.leadBg; if (placed.leadPath) ctx.fill(new Path2D(placed.leadPath))
            ctx.fillStyle = colors.phraseBg; if (placed.phrasePath) ctx.fill(new Path2D(placed.phrasePath))
            ctx.textBaseline = 'middle'
            for (const line of placed.lines) {
              ctx.font = css(placed.size, line.phrase); ctx.fillStyle = line.phrase ? colors.phraseInk : colors.leadInk
              ctx.fillText(line.text, out.width / 2, line.center)
            }
          } else {
          if (box) {
            // Floating text on a box: a snug rounded box behind each line, as the export draws it.
            const centers = shown.map((_, i) => top + i * lineH + lineH / 2)
            const rects = textBoxRects(shown.map((line) => ctx.measureText(line).width), centers, lineH, out.width, size)
            ctx.globalAlpha = box.opacity; ctx.fillStyle = box.color
            ctx.fill(new Path2D(textBoxPath(textBoxOutline(rects, size * TEXT_BOX.radius, size * TEXT_BOX.radius))))
            ctx.globalAlpha = 1; ctx.textBaseline = 'middle'
          }
          shown.forEach((line, i) => {
            const y = box ? top + i * lineH + lineH / 2 : top + i * lineH
            if (!bar && !box) { ctx.lineWidth = Math.max(2, size / 7); ctx.strokeStyle = '#000'; ctx.strokeText(line, out.width / 2, y) }
            ctx.fillStyle = headlineTextColor(hook.look); ctx.fillText(line, out.width / 2, y)
          })
          }
          ctx.textAlign = 'start'
        }
      }
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [])

  /** Add a clip (from transcript lines, or a variant of `sourceId`). Main saves it and assigns its id. */
  const addClip = async (draft: CandidateEdit, sourceId: string | undefined, done: string): Promise<void> => {
    if (busy) return
    if (typeof getApi().editor.addCandidate !== 'function') { setError('Restart CreatorClips to add clips. Your edits are saved when you leave the editor.'); return }
    video.current?.pause(); setEditingCaption(null); setError(null); setNotice(null); setBusy('save')
    try {
      await save()
      const s = await getApi().editor.addCandidate(outputDir, sessionRef.current!.project.revision, draft, sourceId)
      const added = s.project.candidates.at(-1)!
      // Undo keeps whole clip lists: each one gains the new clip, or later saves would not match the project.
      setUndo((u) => u.map((list) => [...list, added])); setRedo((r) => r.map((list) => [...list, added]))
      setSession(s); sessionRef.current = s; setEdits(s.project.candidates); editsRef.current = s.project.candidates
      savedKey.current = JSON.stringify(s.project.candidates.map(candidateEdit)); keyRef.current = savedKey.current
      setSelected(s.project.candidates.length - 1); setLines(null)
      setNotice(done)
    } catch (e) {
      const message = errorMessage(e)
      setError(message)
      if (message.includes(EDITOR_REVISION_CONFLICT)) setConflict(true)
    } finally { setBusy(null) }
  }
  const suggestHooks = async (): Promise<void> => {
    if (!candidate || busy) return
    if (typeof getApi().editor.suggestHooks !== 'function') { setError('Restart CreatorClips to get hook ideas.'); return }
    video.current?.pause(); setError(null); setNotice(null); setBusy('suggest-hooks')
    const id = candidate.id
    try {
      await save()
      const { hooks } = await getApi().editor.suggestHooks(outputDir, sessionRef.current!.project.revision, id)
      setHookIdeas({ id, hooks })
    } catch (e) {
      const message = errorMessage(e)
      setError(message)
      if (message.includes(EDITOR_REVISION_CONFLICT)) setConflict(true)
    } finally { setBusy(null) }
  }
  const run = async (action: 'review' | 'export' | 'export-all' | 'scan-cameras'): Promise<void> => {
    if (!candidate || busy) return
    video.current?.pause(); setError(null); setNotice(null); setBatch(undefined); setBusy(action)
    setProgress(action === 'scan-cameras' ? { phase: 'scan', percent: 0 } : undefined)
    let saved = false, active = true, pollPending = false, polling: number | undefined
    const count = edits.filter((c) => c.status === 'ready').length
    try {
      await save()
      saved = true
      if (action === 'export-all') setBatch({ completed: 0, total: count })
      if (action === 'export-all' || action === 'scan-cameras') {
        polling = window.setInterval(() => {
          if (pollPending) return
          pollPending = true
          void getApi().editor.progress(outputDir).then((s) => {
            if (!active) return
            if (s.batch) setBatch(s.batch)
            if (s.progress) setProgress(s.progress)
          }).catch(() => {}).finally(() => { pollPending = false })
        }, 1000)
      }
      const s = await getApi().editor.run(outputDir, sessionRef.current!.project.revision, candidate.id, action)
      setSession(s); sessionRef.current = s; setEdits(s.project.candidates); setUndo([]); setRedo([])
      editsRef.current = s.project.candidates
      savedKey.current = JSON.stringify(s.project.candidates.map(candidateEdit))
      keyRef.current = savedKey.current
      if (action === 'scan-cameras') { setSelectedCamera(null); setTab('framing'); setNotice('Scan complete. Select a camera marker to inspect the cut, insert a layout, or dismiss it. Arrow keys step through source frames.') }
      if (action === 'export-all') setNotice(`Baked ${count} ready clip${count === 1 ? '' : 's'}. Your exports are ready.`)
    } catch (e) {
      // Earlier exports in a batch are durable even if a later one fails.
      if (saved) { await load(); setUndo([]); setRedo([]) }
      const message = errorMessage(e)
      setError(action === 'scan-cameras' && message.includes('Invalid editor operation')
        ? 'Restart CreatorClips to load camera scanning. Your edits are saved.'
        : message)
      if (message.includes(EDITOR_REVISION_CONFLICT)) setConflict(true)
    } finally { active = false; window.clearInterval(polling); setBusy(null); setBatch(undefined); setProgress(undefined) }
  }
  const chooseReplacement = async (): Promise<void> => {
    video.current?.pause(); setEditingCaption(null)
    try {
      if (typeof getApi().editor.replaceSource !== 'function') throw new Error('Restart CreatorClips to enable source replacement. Your edits will be saved when you leave the editor.')
      setReplacement(await getApi().dialog.selectVideo())
    } catch (e) { setError(errorMessage(e)) }
  }
  const replaceSource = async (path: string): Promise<void> => {
    setBusy('replace-source'); setError(null); setNotice(null)
    let saved = false
    try {
      await save(); saved = true
      await getApi().editor.replaceSource(outputDir, sessionRef.current!.project.revision, path)
      await load(); setUndo([]); setRedo([])
      setNotice('Source replaced. Your edits are preserved. Previously baked clips are ready to bake again; existing exports are unchanged.')
    } catch (e) {
      if (saved) await load()
      setError(errorMessage(e))
    } finally { setBusy(null) }
  }
  const freeMedia = async (): Promise<void> => {
    setBusy('save'); setError(null); setNotice(null)
    try {
      await save()
      const s = await getApi().editor.freeMedia(outputDir, sessionRef.current!.project.revision)
      setSession(s); sessionRef.current = s; setUndo([]); setRedo([])
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(null) }
  }
  if (session?.mediaMissing) return <div className="p-8 space-y-4">{leading}
    <p role="status" className="text-sm">This run’s video was removed to save space. Your clips are unchanged. Get the video again to keep editing them.</p>
    <div className="flex gap-2">{onNeedSource && <Button variant="primary" onClick={onNeedSource}>Get the video again</Button>}<Button onClick={() => { void onExports().catch((e) => setError(errorMessage(e))) }}>View clips</Button></div>
    {error && <p role="alert" className="text-danger">{error}</p>}</div>
  if (session?.project.media_freed) return <div className="p-8 space-y-4">{leading}
    <p role="status" className="text-sm">Editor media for this project was freed to save disk space. Your exported clips are unchanged; the project is now read-only.</p>
    <Button onClick={() => { void onExports().catch((e) => setError(errorMessage(e))) }}>View exports</Button>{error && <p role="alert" className="text-danger">{error}</p>}</div>
  if (!session || !candidate || !currentScene) return <div className="p-8 space-y-4">{leading}<p role={error ? 'alert' : 'status'}>{error ?? 'Opening editor…'}</p><Button onClick={() => { void load() }}>Retry</Button></div>
  const safeLeading = isValidElement<{ onClick?: () => void }>(leading) && leading.props.onClick
    ? cloneElement(leading, { onClick: () => { void save().then(() => leading.props.onClick?.()).catch((e) => setError(errorMessage(e))) } }) : leading
  const project = session.project, aspect = project.aspect_ratio === '9:16' ? 9 / 16 : 16 / 9
  // Renderer hot reload can precede a main-process restart in development.
  // Older editor sessions omit this field; treat them like legacy projects.
  const suppressedCaptions = candidate.caption_suppression_ranges ?? []
  const captionPosition = candidate.caption_y ?? captionAnchor(project, candidate, time).y
  const setGraphics = (graphics: EditorGraphic[], remember = true): void => change({ graphics }, remember)
  /** A graphic from the gallery at the gallery's spot: filled with the words said there, selected and shown on the preview. */
  const insertGraphic = (template: GraphicTemplateId, look?: string): void => {
    if (gallery === null || editingDisabled) return
    const at = gallery
    const place = (pictures: Record<string, string>): void => {
      // For an effect, `look` is which effect.
      const draft = draftGraphic(project, candidate, template, at, clipWords, template === 'fx' ? look : undefined)
      const g = look && template !== 'fx' ? { ...draft, fields: { ...draft.fields, variant: look } } : { ...draft, fields: { ...draft.fields, ...pictures } }
      setGraphics(withGraphic(candidate, g, graphicCap)); setGraphicId(g.id); setGallery(null); setTab('graphics')
      showGraphic(g)
    }
    // An effect on the member's own screenshots or photos asks for them first (nothing is added without them).
    const needed = template === 'fx' ? fxPictureFields(fxEffect(look)).filter((f) => f.required) : []
    if (!needed.length) { place({}); return }
    void (async () => {
      const pictures: Record<string, string> = {}
      for (const f of needed) {
        let name: string | null = null
        try { name = await getApi().editor.graphicImage(outputDir) } catch (e) { setError(errorMessage(e)); return }
        if (!name) return
        pictures[f.key] = name
      }
      place(pictures)
    })()
  }
  // One of My logos from the gallery: copied into the run, then a Logo pop with it at the playhead.
  const insertLogo = (logo: LogoSummary): void => {
    if (gallery === null || editingDisabled) return
    const at = gallery
    void getApi().editor.logoImage(outputDir, logo.id).then((name) => {
      const draft = draftGraphic(project, candidate, 'logo', at, clipWords)
      const g = { ...draft, fields: { ...draft.fields, image: name } }
      setGraphics(withGraphic(candidate, g, graphicCap)); setGraphicId(g.id); setGallery(null); setTab('graphics')
      showGraphic(g)
    }).catch((e: unknown) => setError(errorMessage(e)))
  }
  const selectGraphic = (id: string | null): void => {
    setGraphicId(id)
    if (!id) return
    if (tab !== 'chat') setTab('graphics')
    // Shown once the edit that made it (a copy, a new one) is in.
    if (!dragging.current) showPending.current = id
  }
  const suggestGraphics = (send: boolean): void => {
    video.current?.pause(); setTab('chat')
    if (send) setChatAuto({ id: Date.now(), text: 'Suggest graphics for this clip: add 3 to 5 that help most (a chapter header at each step, a diagram or list where I list things, a stat where I say a number, big words for the key phrase), each timed to the words I say, using only my words.' })
  }
  const moveCaption = (y: number, remember = true): void => { video.current?.pause(); change({ caption_y: Math.round(y * 1000) / 1000 }, remember) }
  const status = candidate.status ?? 'refining'
  const readyCount = edits.filter((c) => c.status === 'ready').length
  const finished = editorProgress(edits).remaining === 0
  const editingDisabled = !!busy || status === 'discarded'
  const captionText = (index: number): string => candidate.caption_edits?.find((e) => e.segment === index)?.text ?? project.transcript[index].text
  const canEditCaption = (index: number): boolean => !editingDisabled && (candidate.caption_edits.length < 2000 || candidate.caption_edits.some((e) => e.segment === index))
  const editCaption = (index: number): void => {
    if (!canEditCaption(index)) return
    video.current?.pause(); firstCaptionChange.current = true; setTab('transcript'); setEditingCaption(index)
  }
  const updateCaption = (index: number, text: string, remember = true): void => {
    const caption_edits = (candidate.caption_edits ?? []).filter((e) => e.segment !== index)
    if (text !== project.transcript[index].text) caption_edits.push({ segment: index, text })
    change({ caption_edits: caption_edits.sort((a, b) => a.segment - b.segment) }, remember)
  }
  const current = reviewCurrent(candidate)
  // A project made from an Automatic run: a bake replaces the clip in the Library.
  const automatic = project.automatic
  const replaces = candidate.library_clip !== undefined
  const full = edits.length >= MAX_EDITOR_CANDIDATES
  const askStyle = (): void => {
    if (editingDisabled) return
    const { changed } = applyStyleToAll(edits, selected)
    if (!changed) { setNotice('Every other clip already uses this style.'); return }
    setConfirmStyle(changed)
  }
  const applyStyle = (): void => {
    if (busy) return
    const { candidates: next } = applyStyleToAll(edits, selected)
    // Like any edit: a baked clip that changes can be restored to Baked by undo.
    next.forEach((c, i) => { if (c !== edits[i] && edits[i].status === 'baked') bakedKeys.current.set(edits[i].id, renderEditKey(edits[i])) })
    setUndo((u) => [...u.slice(-49), edits]); setRedo([])
    setEdits(next)
  }
  const styleButton = <div className="space-y-1 border-t border-white/10 pt-3">
    <Button size="sm" variant="ghost" icon={<Paintbrush size={13} />} disabled={editingDisabled || edits.length < 2} onClick={askStyle}
      tooltip="Copy this clip’s captions (on or off), caption style and position, hook look, call to action and export speed to every clip that isn’t discarded. Hook words stay as they are.">Use this style on every clip</Button>
  </div>
  const lineRange = lines ? transcriptRange(project.transcript, lines.first, lines.last, project.duration_ms) : null
  const selectLine = (i: number, extend: boolean): void => setLines((l) => extend && l ? { anchor: l.anchor, first: Math.min(l.anchor, i), last: Math.max(l.anchor, i) } : { anchor: i, first: i, last: i })
  const makeClip = (): void => {
    if (!lines || full) return
    const draft = transcriptClip(project, edits, lines.first, lines.last)
    if (draft) void addClip(draft, undefined, `Made a new clip from ${lines.last - lines.first + 1} transcript line${lines.last === lines.first ? '' : 's'}. Edit its title, cut and hook, then mark it ready.`)
  }
  const spoken = project.transcript.some((r) => candidate.ranges.some(([a, b]) => r.start_ms < b && r.end_ms > a && r.text.trim()))
  const ideas = hookIdeas?.id === candidate.id ? hookIdeas.hooks : null
  const start = candidate.ranges[0][0], end = candidate.ranges[candidate.ranges.length - 1][1]
  const [viewStart, viewEnd] = dragWindow ?? zoomWindow ?? (timelineZoom === 'source' ? [0, project.duration_ms] : [Math.max(0, start - 10000), Math.min(project.duration_ms, end + 10000)])
  const sceneIndex = candidate.scenes.indexOf(currentScene)
  const canAnimate = canAnimateScene(candidate.scenes, sceneIndex)
  const crop = currentScene.crops[Math.min(panel, currentScene.crops.length - 1)]
  // The selected panel's shape: a split's halves follow its size.
  const panelAspect = aspect / panelRows(currentScene)[Math.min(panel, currentScene.crops.length - 1)][1]
  const topShare = splitOf(currentScene)
  const setSplit = (value: number, remember = true): void => sceneChange(resizeSplit(currentScene, value, aspect, project.width, project.height), remember)
  const sceneChange = (patch: Partial<EditorScene>, remember = true): void => change({ scenes: candidate.scenes.map((s, i) => i === sceneIndex ? { ...s, ...patch } : s) }, remember)
  const cropChange = (c: Crop, remember = true): void => sceneChange({ crops: currentScene.crops.map((r, i) => i === Math.min(panel, currentScene.crops.length - 1) ? c : r) }, remember)
  // Camera + screen: what this part shows, and the screen's size in a split.
  const pair = project.pair
  const screenKind = pair ? screenKindOf(currentScene, pair) : null
  const screenShare = pair ? screenShareOf(currentScene, pair) : 0
  const setScreenLayout = (kind: ScreenKind, share = screenShare): void => {
    if (!pair) return
    setPanel(0)
    const fresh = screenScene(kind, currentScene.at_ms, pair, project, share)
    sceneChange({ layout: fresh.layout, crops: fresh.crops, split: fresh.split, transition_ms: undefined })
  }
  const setLayout = (layout: EditorScene['layout']): void => {
    setPanel(0)
    sceneChange({ layout, split: undefined, crops: layout === 'split' ? [defaultCrop(project.width, project.height, aspect / SPLIT_RANGE.default, .25), defaultCrop(project.width, project.height, aspect / SPLIT_RANGE.default, .75)] : [defaultCrop(project.width, project.height, aspect)] })
  }
  const newLayout = (position?: number): void => {
    const v = video.current
    if (!v || editingDisabled) return
    v.pause()
    const at = snapFrame(frames, position ?? presentedTime.current ?? v.currentTime * 1000)
    if (candidate.scenes.length >= 60 || at <= start || at >= end || candidate.scenes.some((s) => Math.abs(s.at_ms - at) < .01)) return
    change({ scenes: [...candidate.scenes, { ...structuredClone(framingAt(candidate, at)), at_ms: at, transition_ms: undefined }].sort((a, b) => a.at_ms - b.at_ms) })
    // Keep the exact frame boundary selected while adjusting its crops.
    seek(at); setTab('framing')
  }
  const moveScene = (index: number, at: number): void => {
    if (editingDisabled) return
    const scenes = retimeScene(candidate.scenes, index, at, project.duration_ms, frames)
    if (scenes === candidate.scenes) return
    video.current?.pause(); change({ scenes }); seek(scenes[index].at_ms); setTab('framing')
    if (scenes[index].at_ms < viewStart || scenes[index].at_ms > viewEnd) setTimelineZoom('source')
  }
  const startSceneDrag = (e: React.PointerEvent<HTMLButtonElement>, index: number): void => {
    if (editingDisabled || e.button !== 0) return
    e.preventDefault(); e.stopPropagation(); video.current?.pause()
    const target = e.currentTarget, bounds = target.parentElement!.getBoundingClientRect(), x = e.clientX
    const original = candidate.scenes[index].at_ms
    let previous = original, changed = false
    seek(original); setTab('framing'); setDragWindow([viewStart, viewEnd])
    dragging.current = true; target.focus({ preventScroll: true }); target.setPointerCapture(e.pointerId)
    const move = (event: PointerEvent): void => {
      if (!changed && Math.abs(event.clientX - x) < 3) return
      const t = original + (event.clientX - x) / bounds.width * (viewEnd - viewStart)
      const marker = cameraMarkers(candidate, cameraThreshold).reduce<number | null>((best, m) => Math.abs(m.at_ms - t) <= (viewEnd - viewStart) * 8 / bounds.width && (best === null || Math.abs(m.at_ms - t) < Math.abs(best - t)) ? m.at_ms : best, null)
      const scenes = retimeScene(candidate.scenes, index, Math.max(viewStart, Math.min(viewEnd, marker ?? t)), project.duration_ms, frames)
      const next = scenes[index].at_ms
      if (next === previous) return
      if (!changed) { setUndo((u) => [...u.slice(-49), edits]); setRedo([]); changed = true }
      previous = next
      setEdits((items) => items.map((c, i) => i === selected ? refineEdit(c, { scenes }) : c))
      seek(next)
    }
    const done = (): void => {
      target.removeEventListener('pointermove', move); target.removeEventListener('lostpointercapture', done)
      dragging.current = false; setDragWindow(null)
    }
    target.addEventListener('pointermove', move); target.addEventListener('lostpointercapture', done)
  }
  const startCropDrag = (e: React.PointerEvent<HTMLButtonElement>, index: number, corner?: CropCorner): void => {
    if (editingDisabled || e.button !== 0) return
    e.preventDefault(); e.stopPropagation(); setPanel(index); video.current?.pause()
    const target = e.currentTarget, bounds = target.closest('.editor-source-frame')!.getBoundingClientRect()
    const x = e.clientX, y = e.clientY, original = [...currentScene.crops[index]] as Crop
    let previous = original, changed = false
    dragging.current = true; target.focus({ preventScroll: true }); target.setPointerCapture(e.pointerId); setCropDragging(true)
    const move = (event: PointerEvent): void => {
      const dx = event.clientX - x, dy = event.clientY - y
      const next: Crop = corner ? resizeCrop(original, corner, dx, dy, bounds.width, bounds.height)
        : [Math.max(0, Math.min(1 - original[2], original[0] + dx / bounds.width)), Math.max(0, Math.min(1 - original[3], original[1] + dy / bounds.height)), original[2], original[3]]
      if (next.every((n, i) => Math.abs(n - previous[i]) < 1e-10)) return
      if (!changed) { setUndo((u) => [...u.slice(-49), edits]); setRedo([]); changed = true }
      previous = next
      setEdits((items) => items.map((c, ci) => ci !== selected ? c : refineEdit(c, {
        scenes: c.scenes.map((s, si) => si !== sceneIndex ? s : { ...s, crops: s.crops.map((crop, i) => i === index ? next : crop) })
      })))
    }
    const done = (): void => {
      target.removeEventListener('pointermove', move); target.removeEventListener('lostpointercapture', done)
      dragging.current = false; setCropDragging(false)
    }
    target.addEventListener('pointermove', move); target.addEventListener('lostpointercapture', done)
  }
  // ── Chat tab: answers are applied through change(), so Undo, autosave and Bake work as for any edit.
  // One clock: the playhead, graphics, pins and chat cards show clip time (where a moment plays in the finished clip).
  const playheadOut = outputTime(candidate, time)
  const clipClock = (source: number): string => clock(nearestOutputTime(candidate, source))
  const chatProject = { duration_ms: project.duration_ms, width: project.width, height: project.height, aspect_ratio: project.aspect_ratio, transcriptCount: project.transcript.length }
  const chatKey = (c: EditorCandidate): string => JSON.stringify(candidateEdit(c))
  /** Seek to `at` and play `seconds` of it; outside the clip's cut, "Play cuts only" is paused for it. */
  const playMoment = (at: number, seconds: number, anywhere = false): void => {
    const v = video.current
    if (!v) return
    if (chatPlay.current) { window.clearTimeout(chatPlay.current.timer); if (chatPlay.current.restoreCut) setPreviewCut(true); chatPlay.current = null }
    v.pause()
    // Let the edit render first, so playback follows the new cut.
    window.setTimeout(() => {
      const c = candidateRef.current
      const inside = !!c && c.ranges.some(([a, b]) => at >= a && at + seconds * 1000 <= b)
      const restoreCut = anywhere && !inside && previewCutRef.current
      if (restoreCut) { previewCutRef.current = false; setPreviewCut(false) }
      seek(at)
      if (seconds <= 0) return
      window.setTimeout(() => {
        void video.current?.play().catch(() => {})
        const timer = window.setTimeout(() => {
          video.current?.pause()
          if (chatPlay.current?.restoreCut) setPreviewCut(true)
          chatPlay.current = null
        }, seconds * 1000 / Math.max(.5, (c?.video_speed ?? 1) * reviewSpeed))
        chatPlay.current = { timer, restoreCut }
      }, restoreCut ? 60 : 0)
    }, 60)
  }
  const applyChat = (steps: ChatStep[]): ChatApplyResult => {
    const editing = steps.filter((s) => Object.keys(s.patch).length)
    let applied: ChatApplied | null = null, length: string | null = null
    if (editing.length) {
      if (editingDisabled) return { error: status === 'discarded' ? 'Restore this clip to change it.' : 'Wait for the current task to finish, then ask again.' }
      let patch: ChatPatch
      try { patch = mergeChatSteps(candidate, editing, chatProject) } catch (e) { return { error: errorMessage(e) } }
      const after = refineEdit(candidate, patch)
      applied = { clipId: candidate.id, before: patchValues(candidate, Object.keys(patch) as (keyof ChatPatch)[]), afterKey: chatKey(after) }
      // The card mentions the clip's length only when this answer changed it.
      length = editDuration(after) === editDuration(candidate) ? null : clipLengthNote(after)
      video.current?.pause(); setEditingCaption(null)
      change(patch)
    }
    const focus = [...steps].reverse().find((s) => s.focus_ms !== null)
    if (focus) playMoment(focus.focus_ms!, focus.play_seconds, focus.tool === 'play')
    return { applied, length }
  }
  const undoChat = (applied: ChatApplied): string | null => {
    if (applied.clipId !== candidate.id) return 'Open that clip to undo this change.'
    if (editingDisabled) return 'Wait for the current task to finish, then undo.'
    // Still the latest change: a real undo step. Otherwise put the old values back as a new change.
    if (chatKey(candidate) === applied.afterKey && undo.length) history('undo')
    else change(applied.before)
    return null
  }
  return <section ref={editorRoot} className={cn('clip-editor', bigPreview && 'big-preview-mode')} aria-label="Clip editor">
    <header className="editor-header"><div className="min-w-0 flex-1"><div className="flex items-center gap-3">{safeLeading}<span className="editor-title truncate">{project.title}</span></div><span className="text-2xs text-ink-subtle">{saving ? 'Saving…' : key !== savedKey.current ? 'Unsaved changes' : 'All changes saved'}</span></div>
      <Button variant="ghost" size="sm" onClick={() => setShowAudit(true)}>Transcript & edits</Button>
      {finished && <Button variant="ghost" size="sm" disabled={!!busy} tooltip="Every clip is baked or discarded. Delete this project's source copy and preview; exports stay in the Library." onClick={() => setConfirmFree(true)}>Free editor media{session.mediaBytes ? ` (${formatBytes(session.mediaBytes)})` : ''}</Button>}
      <Button size="sm" disabled={!!busy} onClick={() => { void save().then(onExports).catch((e) => setError(errorMessage(e))) }}>Exports</Button>
      <div className="editor-bake-actions" role="group" aria-label="Bake clips">
      <Button variant="primary" size="sm" disabled={!!busy || status !== 'ready'} title={status !== 'ready' ? 'Mark this clip ready after refining it' : replaces ? 'Render the clip with your changes and replace it in your Library' : 'Render the final clip with your changes'} icon={<Download size={14} />} onClick={() => { void run('export') }}>{candidate.captions ? 'Bake captions' : 'Render clip'}</Button>
      <ActionMenu label="More bake options" disabled={!!busy || readyCount === 0} icon={<ChevronDown aria-hidden size={14} />} triggerClassName="btn-primary editor-bake-toggle disabled:opacity-100" actions={[{ label: `Bake all ready clips (${readyCount})`, disabled: readyCount === 0, icon: <Download size={14} />, onSelect: () => { void run('export-all') } }]} />
      </div>
    </header>
    <div className="px-[18px]"><SavedStageTimings outputDir={outputDir} /></div>
    <div className="editor-stagebar">
      <span className={cn('editor-status', status)}>{status === 'baked' || status === 'ready' ? <Check size={12} /> : status === 'discarded' ? <Archive size={12} /> : <Pencil size={12} />}{statusLabels[status]}</span>
      <span className="editor-stage-hint">{status === 'refining' ? 'Review the cut, framing and captions.' : status === 'ready' ? 'Ready for the final render.' : status === 'baked' ? replaces ? 'This clip is in your Library. To change it, edit it, mark it ready, then bake to replace it.' : 'Your finished clip is in Exports.' : 'Set aside. Restore it whenever you need.'}</span>
      <div className="ml-auto flex gap-2">
        <Button variant="ghost" size="sm" disabled={!!busy || status === 'discarded' || full} icon={<Copy size={13} />}
          tooltip={full ? `A project can hold up to ${MAX_EDITOR_CANDIDATES} clips.` : 'Make a copy of this clip with the same cut and settings, to test a different hook.'}
          onClick={() => { void addClip(variantOf(candidate, edits), candidate.id, 'Made a copy of this clip. Change its hook to test it against the original.') }}>Duplicate as variant</Button>
        {status !== 'discarded' && <Button variant="ghost" size="sm" disabled={!!busy} icon={<Archive size={13} />} onClick={() => { video.current?.pause(); setEditingCaption(null); change({ status: 'discarded' }) }}>Discard</Button>}
        {status === 'refining' ? <Button size="sm" variant="primary" disabled={!!busy} icon={<Check size={13} />} onClick={() => { setEditingCaption(null); change({ status: 'ready' }) }}>Mark ready</Button>
          : <Button size="sm" disabled={!!busy} icon={<RotateCcw size={13} />} onClick={() => change({ status: 'refining' })}>{status === 'discarded' ? 'Restore clip' : status === 'baked' ? 'Refine again' : 'Keep refining'}</Button>}
      </div>
    </div>
    {error && <div role="alert" className="editor-notice text-danger">{conflict ? 'This project changed since the editor opened it, so your latest edits cannot be saved. Reload the project to continue from its saved state.' : error}{conflict
      ? <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={() => { setUndo([]); setRedo([]); bakedKeys.current.clear(); void load() }}>Reload project</Button>
      : key !== savedKey.current && <Button size="sm" variant="ghost" onClick={() => { setError(null); void save().catch((e) => setError(errorMessage(e))) }}>Retry save</Button>}</div>}
    {automatic && originNote && <div role="note" className="editor-notice"><span>These clips were made automatically. Baking a clip replaces it in your Library; clips you don’t bake stay exactly as they are.
      {automatic.omitted.length > 0 && ` A clip baked again has no ${listWords(automatic.omitted.map((o) => omissionLabels[o]))}.`}
      {automatic.estimated_cuts > 0 && ` This run didn’t save its exact cuts, so ${automatic.estimated_cuts === 1 ? 'one clip’s cut was' : `${automatic.estimated_cuts} clips’ cuts were`} worked out again and may differ slightly from your clips.`}</span>
      <Button size="sm" variant="ghost" aria-label="Dismiss note about automatic clips" iconOnly icon={<X size={14} />} onClick={() => setOriginNote(false)} /></div>}
    {notice && !busy && <div role="status" className="editor-notice"><Check size={14} />{notice}<Button size="sm" variant="ghost" tooltip="Hide this completion message." aria-label="Dismiss bake notice" iconOnly icon={<X size={14} />} onClick={() => setNotice(null)} /></div>}
    {confirmFree && <ConfirmDialog onClose={closeFree} request={{
      title: 'Free editor media?', confirmLabel: 'Free media',
      body: automatic
        ? <>Delete this run's copy of the source video and its editor preview{session.mediaBytes ? ` (${formatBytes(session.mediaBytes)})` : ''}?<br /><br />Your clips stay in the Library. To edit them again later, CreatorClips downloads the video again, or uses the original file.</>
        : <>Delete this project's copy of the source video and its editor preview{session.mediaBytes ? ` (${formatBytes(session.mediaBytes)})` : ''}?<br /><br />Your exported clips stay in the Library. The project becomes read-only: you won't be able to refine, re-bake or restore its clips again.</>,
      onConfirm: () => { void freeMedia() }
    }} />}
    {confirmStyle !== null && <ConfirmDialog onClose={closeStyle} request={{
      title: 'Use this style on every clip?', confirmLabel: `Update ${confirmStyle} clip${confirmStyle === 1 ? '' : 's'}`, tone: 'primary',
      body: <>Copy this clip’s captions (on or off), caption style and position, hook look, call to action and export speed to {confirmStyle} other clip{confirmStyle === 1 ? '' : 's'}?<br /><br />Hook words don’t change. Discarded clips are left alone. Clips whose look changes go back to Refining. Undo puts everything back.</>,
      onConfirm: applyStyle
    }} />}
    {replacement && <ConfirmDialog onClose={closeReplacement} request={{
      title: 'Replace source video?', confirmLabel: 'Replace source', tone: 'primary',
      body: <>Use <strong>{replacement.split(/[\\/]/).pop()}</strong> for every clip in this project?<br /><br />Only recommended for the exact same video at higher quality: identical content, timing, audio and framing. Matching duration alone does not guarantee a match.<br /><br />Your cuts, layouts and caption edits will be kept. Previously baked clips will be ready to bake again. Existing exports will stay in the library.</>,
      onConfirm: () => { void replaceSource(replacement) }
    }} />}
    {busy && <div role="status" className="editor-notice"><Loader2 size={14} className="animate-spin" />{busy === 'scan-cameras' ? <div className="editor-scan-progress"><span>{progress?.phase === 'preview' ? 'Preparing frame-accurate preview (one-time)' : 'Scanning frames for camera changes'}… {progress?.percent ?? 0}%</span><progress aria-label={progress?.phase === 'preview' ? 'Preview preparation progress' : 'Camera scan progress'} max={100} value={progress?.percent ?? 0} /></div> : busy === 'replace-source' ? 'Replacing source and preparing preview…' : busy === 'export-all' ? `Baking ready clips… ${batch?.completed ?? 0} of ${batch?.total ?? readyCount} complete${batch?.failed ? `, ${batch.failed} failed` : ''}` : busy === 'review' ? 'Jev is reviewing your edit…' : busy === 'suggest-hooks' ? 'Writing hook ideas from this clip’s words…' : busy === 'export' ? replaces ? 'Baking your clip and replacing it in the Library…' : 'Baking your final clip…' : 'Saving…'}<Button size="sm" variant="ghost" onClick={() => { void getApi().editor.cancel(outputDir) }}>Cancel</Button></div>}
    <div className="editor-workspace">
      <aside className="editor-candidates"><div className="editor-pane-heading">Refine clips <span>{edits.length}</span></div>
        {(['refining', 'ready', 'baked', 'discarded'] as const).map((group) => {
          const items = edits.map((c, i) => ({ c, i })).filter(({ c }) => (c.status ?? 'refining') === group)
          if (!items.length) return null
          const cards = items.map(({ c, i }) => <button key={c.id} className={cn('editor-candidate', group, i === selected && 'selected')} onClick={() => setSelected(i)}>
            <span className="flex items-center justify-between text-2xs text-ink-subtle"><span>{String(i + 1).padStart(2, '0')}</span>{c.exports.length > 0 && <span title={`${c.exports.length} saved exports`} className="flex items-center gap-1"><Download size={11} />{c.exports.length}</span>}</span>
            <span className="block text-xs leading-relaxed mt-1">{c.title}</span><span className="flex items-center justify-between mt-2 text-2xs text-ink-subtle"><span>{formatTimecode(c.ranges[0][0])} · {(editDuration(c) / 1000).toFixed(1)}s</span><span title={!reviewCurrent(c) ? 'Jev review out of date' : c.review?.decision === 'passes' ? 'Jev checks passed' : 'Jev: consider before baking'} className={cn('editor-dot', !reviewCurrent(c) ? 'bg-ink-subtle' : c.review?.decision === 'passes' ? 'bg-success' : 'bg-warning')} /></span>
          </button>)
          return group === 'discarded'
            ? <details key={group} className="editor-discarded" open={status === 'discarded' ? true : undefined}><summary>Discarded <span>{items.length}</span><ChevronDown size={12} /></summary>{cards}</details>
            : <div key={group} className="editor-candidate-group"><div className={cn('editor-group-heading', group)}>{statusLabels[group]} <span>{items.length}</span></div>{cards}</div>
        })}
      </aside>
      <div className={cn('editor-center', bigPreview && 'big-preview')}>
        <div className={cn('editor-monitors', tab === 'graphics' && 'graphics-focus')}>
          <div className="editor-source-monitor"><div className="editor-pane-heading">Source <span>{project.width} × {project.height}</span><Button size="sm" variant="ghost" disabled={!!busy || saving} onClick={() => { void chooseReplacement() }}>Replace source video</Button></div>
            <div className="editor-source-frame" style={{ aspectRatio: project.width / project.height, '--ratio': project.width / project.height } as React.CSSProperties}>
              <video ref={video} src={localFileUrl(session.previewPath)} preload="auto" playsInline style={{ filter: gradePreviewFilter(candidate.grade) }}
                onLoadedMetadata={() => { seek(start); if (video.current) video.current.playbackRate = candidate.video_speed * reviewSpeed }}
                onPlay={() => setPlaying(true)} onPause={() => {
                  setPlaying(false)
                  const panel = transcriptPanel.current
                  if (panel) panel.scrollTo({ top: panel.scrollTop, behavior: 'instant' })
                }} onEnded={() => setPlaying(false)}
                onError={() => setError('Source preview is unavailable. Reopen the project or check that its files still exist.')}
                onTimeUpdate={() => {
                  const v = video.current!; let t = v.currentTime * 1000
                  if (previewCut && !v.paused) {
                    const range = candidateRef.current!.ranges.find(([, b]) => t < b)
                    if (!range) { v.pause(); t = candidateRef.current!.ranges.at(-1)![1]; v.currentTime = t / 1000 }
                    else if (t < range[0]) { t = range[0]; v.currentTime = t / 1000 }
                  }
                  if (v.paused && presentedTime.current === null) setTime(t)
                }} />
              {tab === 'framing' && currentScene.layout !== 'fit' && currentScene.crops.map((r, i) => {
                const name = currentScene.layout === 'split' ? (i === 0 ? 'top' : 'bottom') : currentScene.layout === 'bubble' ? (i === 0 ? 'screen' : 'bubble') : 'output'
                return <div key={i} className={cn('editor-crop', i === panel && 'active')} style={{ left: `${r[0] * 100}%`, top: `${r[1] * 100}%`, width: `${r[2] * 100}%`, height: `${r[3] * 100}%` }}>
                  <button className="editor-crop-move" aria-label={`Move ${name} crop`} disabled={editingDisabled} onPointerDown={(e) => startCropDrag(e, i)}>
                    <span>{currentScene.layout === 'split' ? i === 0 ? '1' : '2' : ''}</span>
                  </button>
                  {cropCorners.map((corner) => <button key={corner} className={cn('editor-crop-corner', corner)} aria-label={`Resize ${name} crop from ${corner}`} title="Drag to resize · Arrow keys adjust · Shift for larger steps" disabled={editingDisabled}
                    onPointerDown={(e) => startCropDrag(e, i, corner)} onKeyDown={(e) => {
                      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
                      e.preventDefault(); e.stopPropagation(); setPanel(i); video.current?.pause()
                      const bounds = e.currentTarget.closest('.editor-source-frame')!.getBoundingClientRect(), step = e.shiftKey ? 10 : 1
                      const next = resizeCrop(r, corner, e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0, bounds.width, bounds.height)
                      if (next.some((n, index) => Math.abs(n - r[index]) > 1e-10)) sceneChange({ crops: currentScene.crops.map((c, ci) => ci === i ? next : c) })
                    }} />)}
                </div>
              })}
            </div>
            <p className="editor-monitor-hint">{tab === 'framing' ? 'Drag inside to move · Drag a corner to resize' : 'Space to play · I / O to trim · S to split'} · 1 / 2 / 3 for speed</p>
          </div>
          <div className="editor-output-monitor">
            <div className="editor-pane-heading">Output <span className="flex items-center gap-2">{candidate.captions && suppressedCaptions.some(([a, b]) => a <= time && time < b) ? 'Captions suppressed' : project.aspect_ratio}
              <Button size="sm" variant="secondary" className="editor-add-graphic-here" icon={<Plus size={13} />} disabled={editingDisabled || (candidate.graphics?.length ?? 0) >= graphicCap}
                aria-label="Add a graphic at this moment" tooltip="Add a graphic at this moment, filled with the words you say here (G)." onClick={() => openGallery(time)}>Graphic</Button>
              <Button size="sm" variant={bigPreview ? 'secondary' : 'ghost'} iconOnly icon={bigPreview ? <Minimize2 size={13} /> : <Maximize2 size={13} />} aria-label="Big preview" aria-pressed={bigPreview}
                tooltip={bigPreview ? 'Back to the full timeline (source monitor, cut list and tools).' : 'A bigger output preview, with the timeline down to its cuts, layouts, graphics and scenes.'}
                onClick={() => setBigChoice(!bigPreview)} />
              <PointButton thread={clipChatThread(outputDir, candidate.id)} disabled={!!busy || status === 'discarded'} onStart={() => { video.current?.pause(); setTab('chat') }} /></span></div>
            <canvas ref={canvas} width={aspect < 1 ? 360 : 640} height={aspect < 1 ? 640 : 360} style={{ aspectRatio: aspect }} />
            {project.aspect_ratio === '9:16' && <ScenesOverlay canvas={canvas} candidate={candidate} time={time} />}
            <GraphicsOverlay canvas={canvas} project={project} candidate={candidate} time={time} outputDir={outputDir} sourceUrl={session.previewPath ? localFileUrl(session.previewPath) : undefined} />
            <GraphicPreviewEditor canvas={canvas} project={project} candidate={candidate} time={time} selected={graphicId} words={clipWords} disabled={editingDisabled} playing={playing}
              onSelect={selectGraphic} onChange={setGraphics} onDrag={(active) => { dragging.current = active; if (active) video.current?.pause(); setCropDragging(active) }} />
            <PointLayer thread={clipChatThread(outputDir, candidate.id)} canvas={canvas} outMs={() => Math.round(nearestOutputTime(candidate, timeRef.current))} />
            {showSubtitlePreview && (tab === 'transcript' || tab === 'captions') && <EditorCaptionPreview canvas={canvas} project={project} candidate={candidate} time={time} disabled={editingDisabled} onMove={moveCaption} onDrag={active => { dragging.current = active; if (active) video.current?.pause() }} />}
          </div>
        </div>
        <div className="editor-transport">
          <Button size="sm" variant="ghost" iconOnly icon={<ChevronLeft size={14} />} aria-label="Previous frame" tooltip="Move back one source frame. Exact after scanning; approximate outside scanned footage." disabled={!!busy || time <= .01} onClick={() => frameStep(-1)} />
          <Button size="sm" variant="ghost" iconOnly icon={<ChevronRight size={14} />} aria-label="Next frame" tooltip="Move forward one source frame. Exact after scanning; approximate outside scanned footage." disabled={!!busy || time >= project.duration_ms - 1 - .01} onClick={() => frameStep(1)} /><Button tooltip="Move the playhead to the beginning of this clip." aria-label="Back to start" iconOnly variant="ghost" icon={<SkipBack size={15} />} onClick={() => seek(start)} /><Button tooltip="Play or pause the preview. Shortcut: Space." aria-label="Play / pause" iconOnly icon={playing ? <Pause size={16} /> : <Play size={16} />} onClick={toggle} /><span className="font-mono text-xs" title="Where the playhead is in the finished clip">{playheadOut === null ? 'Outside the cut' : clock(playheadOut)}</span><span className="text-ink-subtle text-2xs">/ {(editDuration(candidate) / 1000).toFixed(1)}s clip</span><span className="text-ink-subtle text-2xs font-mono" title="The same moment in the source video">Source {clock(time)}</span><label className="editor-review-speed" title="Preview only. Press 1/2/3 for speed; arrow keys step 1/2/3 source frames (1.5× rounds to two). Shift+arrows jump one second. Multiplies the clip’s export speed without changing the export.">Review speed<select aria-label="Review speed" value={reviewSpeed} onChange={(e) => {
            setReviewSpeed(Number(e.target.value))
            // Return Space to playback after choosing a speed.
            e.currentTarget.blur()
          }}>{[1, 1.5, 2, 3].map((speed) => <option key={speed} value={speed}>{speed}×</option>)}</select></label><label className="ml-auto flex gap-2 items-center text-2xs text-ink-muted"><input type="checkbox" checked={previewCut} onChange={(e) => setPreviewCut(e.target.checked)} />Play cuts only</label></div>
        <div className="editor-timeline">
          <div className="editor-timeline-tools">
            <CameraScanButton key={candidate.id} candidate={candidate} threshold={cameraThreshold} setThreshold={setCameraThreshold}
              restore={() => change({ dismissed_camera_markers: [] })} disabled={editingDisabled} onOpen={() => video.current?.pause()} scan={() => { void run('scan-cameras') }} />
            <Button variant="ghost" size="sm" tooltip="Undo the last editor change (⌘/Ctrl+Z)." aria-label="Undo" iconOnly icon={<Undo2 size={14} />} disabled={!undo.length || !!busy} onClick={() => history('undo')} /><Button variant="ghost" size="sm" tooltip="Redo the change you just undid (⌘/Ctrl+Shift+Z)." aria-label="Redo" iconOnly icon={<Redo2 size={14} />} disabled={!redo.length || !!busy} onClick={() => history('redo')} /><Button variant="ghost" size="sm" icon={<Scissors size={14} />} tooltip="Split the cut at the playhead into two editable sections. No footage is removed. Shortcut: S." onClick={split} disabled={editingDisabled || candidate.ranges.length >= 24}>Split</Button><Button variant="ghost" size="sm" disabled={editingDisabled || (time >= start && time <= end)} tooltip="Extend the clip’s beginning or ending to the playhead. Turn off Play cuts only to move beyond the current cut." onClick={() => { const t = (video.current?.currentTime ?? time / 1000) * 1000; if (t < start) trim('in', t); else if (t > end) trim('out', t) }}>Extend to playhead</Button><Button size="sm" variant="primary" className="editor-add-graphic" icon={<Plus size={14} />} disabled={editingDisabled || (candidate.graphics?.length ?? 0) >= graphicCap}
            tooltip={(candidate.graphics?.length ?? 0) >= graphicCap ? `A clip can have up to ${graphicCap} graphics.` : 'Add an animated graphic at the playhead: a stat, title, list, steps, a diagram and more. Shortcut: G.'}
            onClick={() => openGallery(time)}>Add graphic</Button><span className="ml-auto text-2xs text-ink-subtle">{clock(viewStart)} — {clock(viewEnd)}</span></div>
          <div className="editor-lanes editor-lanes-source">
          <div className="editor-lane"><span className="editor-lane-label" aria-hidden>Source</span>
          <input aria-label="Source timeline" className="editor-source-scrub" type="range" min={0} max={project.duration_ms} step="any" value={time} onChange={(e) => seek(snapFrame(frames, Number(e.target.value)))} /></div>
          <div className="editor-lane"><span className="editor-lane-label" aria-hidden>Clips</span>
          <div className="editor-overview" aria-label="All candidate moments">{edits.map((c, i) => <button key={c.id} title={c.title} aria-label={`Jump to candidate ${i + 1}: ${c.title}`} className={cn(i === selected && 'selected')} style={{ left: `${c.ranges[0][0] / project.duration_ms * 100}%`, width: `${(c.ranges.at(-1)![1] - c.ranges[0][0]) / project.duration_ms * 100}%`, top: (i % 3) * 4 }} onClick={() => { setSelected(i); seek(c.ranges[0][0]) }} />)}</div></div>
          </div>
          <div className="editor-lanes editor-lanes-view">
          <CameraChanges candidate={candidate} threshold={cameraThreshold} selected={selectedCamera} deselect={deselectCamera}
            select={(t) => { video.current?.pause(); setSelectedCamera(t); seek(t); setTab('framing'); if (zoomWindow) setTimelineZoom([Math.max(0, t - 1000), Math.min(project.duration_ms, t + 1000)]) }}
            insert={newLayout} align={moveScene}
            remove={(t) => { change({ dismissed_camera_markers: [...(candidate.dismissed_camera_markers ?? []), t] }); setSelectedCamera(null) }}
            disabled={editingDisabled} viewStart={viewStart} viewEnd={viewEnd} clock={clock} />
          <div className="editor-lane"><span className="editor-lane-label" aria-hidden>Cuts</span>
          <div className="editor-track" onPointerDown={(e) => { if (e.target === e.currentTarget) seek(viewStart + (e.clientX - e.currentTarget.getBoundingClientRect().left) / e.currentTarget.clientWidth * (viewEnd - viewStart)) }}>
            {candidate.ranges.map(([a, b], i) => <div key={i} className="editor-timeline-piece" style={{ left: `${(a - viewStart) / (viewEnd - viewStart) * 100}%`, width: `${(b - a) / (viewEnd - viewStart) * 100}%` }}><button className="editor-trim-handle" aria-label={`Trim start of cut ${i + 1}`} disabled={editingDisabled} title="Drag to trim or extend; arrow keys adjust by 0.1s (Shift: 1s)" onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); change({ ranges: trimRange(candidate.ranges, i, 0, a + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1000 : 100), project.duration_ms) }) } }} onPointerDown={(e) => { video.current?.pause(); dragging.current = true; setDragWindow([viewStart, viewEnd]); trimDrag(e, i, 0, viewStart, viewEnd, project.duration_ms, candidate, edits, selected, setEdits, setUndo, setRedo, () => { dragging.current = false; setDragWindow(null) }) }} /><button className="editor-piece-body" aria-label={`Seek within cut ${i + 1}`} onClick={(e) => {
              // Measure the whole cut, including its handles, so the click lines
              // up with the playhead even when the timeline is zoomed or clipped.
              const rect = e.currentTarget.parentElement!.getBoundingClientRect()
              const target = e.detail === 0 ? a : a + Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * (b - a)
              seek(Math.max(a, Math.min(b - .001, snapFrame(frames, target))))
            }}><Film size={12} /><span>{i + 1}</span></button><button className="editor-trim-handle" aria-label={`Trim end of cut ${i + 1}`} disabled={editingDisabled} title="Drag to trim or extend; arrow keys adjust by 0.1s (Shift: 1s)" onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); change({ ranges: trimRange(candidate.ranges, i, 1, b + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1000 : 100), project.duration_ms) }) } }} onPointerDown={(e) => { video.current?.pause(); dragging.current = true; setDragWindow([viewStart, viewEnd]); trimDrag(e, i, 1, viewStart, viewEnd, project.duration_ms, candidate, edits, selected, setEdits, setUndo, setRedo, () => { dragging.current = false; setDragWindow(null) }) }} /></div>)}
            {candidate.scenes.map((s, i) => i > 0 && s.at_ms >= viewStart && s.at_ms <= viewEnd && <button key={i}
              title={`Layout change at ${clock(s.at_ms)}${editingDisabled ? '' : ` · Drag to move · Arrow keys: ${frames.length ? 'one frame' : '0.1s (scan for frame stepping)'} · Shift: 1s`}`}
              aria-label={`Layout change at ${clock(s.at_ms)}`} className={cn('editor-scene-marker', i === sceneIndex && 'selected', editingDisabled && 'read-only')}
              style={{ left: `${(s.at_ms - viewStart) / (viewEnd - viewStart) * 100}%` }}
              onPointerDown={(e) => startSceneDrag(e, i)} onClick={() => { video.current?.pause(); seek(s.at_ms); setTab('framing') }}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') e.stopPropagation()
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
                e.preventDefault(); e.stopPropagation()
                moveScene(i, e.shiftKey ? s.at_ms + (e.key === 'ArrowLeft' ? -1000 : 1000) : frames.length ? stepFrame(frames, s.at_ms, e.key === 'ArrowLeft' ? -1 : 1) : s.at_ms + (e.key === 'ArrowLeft' ? -100 : 100))
              }} />)}
            {time >= viewStart && time <= viewEnd && <div className="editor-playhead" style={{ left: `${(time - viewStart) / (viewEnd - viewStart) * 100}%` }} />}
          </div></div>
          {/* Each framing layout from its start until the next one, colored by layout (the markers on Cuts move them). */}
          <div className="editor-lane"><span className="editor-lane-label" aria-hidden>Layouts</span>
            <div className="editor-layouts-track" aria-label="Layouts">{candidate.scenes.map((s, i) => {
              const from = Math.max(s.at_ms, start, viewStart), to = Math.min(candidate.scenes[i + 1]?.at_ms ?? end, end, viewEnd)
              if (to <= from) return null
              const kind = pair ? screenKindOf(s, pair) : null
              const name = kind ? SCREEN_KIND_LABELS[kind] : layoutNames[s.layout]
              return <button key={i} type="button" tabIndex={-1} className={cn('editor-layout-block', `layout-${s.layout}`, i === sceneIndex && 'selected')}
                style={{ left: `${(from - viewStart) / (viewEnd - viewStart) * 100}%`, width: `${(to - from) / (viewEnd - viewStart) * 100}%` }}
                aria-label={`${name} layout from ${clock(Math.max(s.at_ms, start))}`} title={`${name} from ${clock(Math.max(s.at_ms, start))} · Click to edit it in Framing`}
                onClick={() => { video.current?.pause(); seek(Math.max(s.at_ms, start)); setTab('framing') }}>{s.transition_ms ? <span className="editor-layout-ease" aria-hidden /> : null}<span>{name}</span></button>
            })}</div></div>
          <GraphicsTrack cap={graphicCap} candidate={candidate} viewStart={viewStart} viewEnd={viewEnd} selected={graphicId} disabled={editingDisabled} clock={clipClock}
            onSelect={selectGraphic} onChange={setGraphics}
            onDrag={(active) => { dragging.current = active; if (active) { video.current?.pause(); setDragWindow([viewStart, viewEnd]) } else setDragWindow(null) }}
            onAdd={() => openGallery(time)} onAddAt={(ms) => { const at = Math.max(start, Math.min(end, ms)); seek(at); openGallery(at) }} />
          {project.zoom && candidate.zooms?.length ? <ZoomsTrack zooms={candidate.zooms} viewStart={viewStart} viewEnd={viewEnd} time={time} disabled={editingDisabled} clock={clipClock}
            onChange={(zooms) => change({ zooms })} seek={(ms) => { video.current?.pause(); seek(ms) }} /> : null}
          {project.aspect_ratio === '9:16' && <ScenesTrack candidate={candidate} viewStart={viewStart} viewEnd={viewEnd} time={time} disabled={editingDisabled} clock={clipClock}
            onChange={(stage_scenes, remember) => change({ stage_scenes }, remember)}
            onDrag={(active) => { dragging.current = active; if (active) { video.current?.pause(); setDragWindow([viewStart, viewEnd]) } else setDragWindow(null) }} />}
          {suppressedCaptions.length > 0 && <div className="editor-lane"><span className="editor-lane-label" aria-hidden>Captions</span><div className={cn('editor-caption-track', !candidate.captions && 'opacity-40')} aria-label="Caption-free sections">
            {suppressedCaptions.map(([a, b], i) => b > viewStart && a < viewEnd && <button key={i}
              aria-label={`Caption-free section ${i + 1}: ${clock(a)} to ${clock(b)}`} title={`Captions suppressed ${clock(a)} – ${clock(b)}`}
              style={{ left: `${(Math.max(a, viewStart) - viewStart) / (viewEnd - viewStart) * 100}%`, width: `${(Math.min(b, viewEnd) - Math.max(a, viewStart)) / (viewEnd - viewStart) * 100}%` }}
              onClick={() => { seek(a); setTab('captions') }} />)}
          </div></div>}
          <input aria-label="Fine timeline position" type="range" min={viewStart} max={viewEnd} step="any" value={Math.max(viewStart, Math.min(viewEnd, time))} onChange={(e) => seek(snapFrame(frames, Number(e.target.value)))} className="editor-fine-scrub" />
          {/* The playhead across every row (the Cuts row draws its own). */}
          {time >= viewStart && time <= viewEnd && <div aria-hidden className="editor-lanes-playhead" style={{ '--at': (time - viewStart) / (viewEnd - viewStart) } as React.CSSProperties} />}
          </div>
          <div className="editor-timeline-footer">
            <div className="editor-cut-list">{candidate.ranges.map(([a, b], i) => <div key={i} className="flex items-center gap-2"><span className="text-2xs text-ink-subtle">{i + 1}</span><TimeInput label={`Cut ${i + 1} start`} value={a} disabled={editingDisabled} onChange={(t) => { const ranges = candidate.ranges.map((r) => [...r] as [number, number]); ranges[i][0] = Math.max(i ? ranges[i - 1][1] : 0, Math.min(b - 100, t)); change({ ranges }) }} /><span className="text-ink-subtle">–</span><TimeInput label={`Cut ${i + 1} end`} value={b} disabled={editingDisabled} onChange={(t) => { const ranges = candidate.ranges.map((r) => [...r] as [number, number]); ranges[i][1] = Math.min(i + 1 < ranges.length ? ranges[i + 1][0] : project.duration_ms, Math.max(a + 100, t)); change({ ranges }) }} /><Button variant="ghost" size="sm" aria-label={`Remove cut ${i + 1}`} tooltip="Remove this cut from the clip. The source video is kept; Undo restores the cut." iconOnly icon={<X size={12} />} disabled={candidate.ranges.length === 1 || editingDisabled} onClick={() => change({ ranges: candidate.ranges.filter((_, j) => j !== i) })} /></div>)}</div>
            <div className="editor-timeline-zoom">
              <span className="text-2xs text-ink-subtle">Timeline zoom</span>
              <Select aria-label="Timeline zoom" size="sm" className="w-32" value={Array.isArray(timelineZoom) ? 'playhead' : timelineZoom}
                options={[{ value: 'source', label: 'Full source' }, { value: 'clip', label: 'Clip' }, { value: 'playhead', label: 'Playhead', detail: '±1 second' }]}
                onChange={(value) => setTimelineZoom(value === 'playhead'
                  ? [Math.max(0, time - 1000), Math.min(project.duration_ms, time + 1000)]
                  : value === 'source' ? 'source' : 'clip')} />
            </div>
          </div>
        </div>
      </div>
      <aside className="editor-inspector">{automatic && <EditLog key={candidate.id} variant="strip" defaultOpen={false} lines={clipEditLog(project, candidate)} disabled={editingDisabled}
        onRestore={(line) => { if (line.restore) change(line.restore) }}
        note={candidate.auto ? 'Undo takes back a Restore.' : 'This clip was opened in the editor before the app kept a record of its cut, so only the graphics it added are listed.'} />}<EditorTabs tab={tab} onTab={setTab} />
        <div ref={transcriptPanel} className="editor-inspector-body">
          {tab === 'review' && <div className="space-y-3">{(() => {
            const checks = [...(candidate.review?.questions ?? []), ...(candidate.review?.cuts.flatMap((cut) => cut.questions) ?? [])]
            const passing = checks.filter((q) => q.probability !== null && q.probability >= q.threshold).length
            return <div className={cn('editor-quality-head', !current ? 'stale' : candidate.review?.decision === 'passes' ? 'passes' : 'consider')}>
              {candidate.review && <span className="editor-quality-count" title={`${passing} of ${checks.length} checks meet their target`}>{passing}<span>/{checks.length}</span></span>}
              <div className="min-w-0 flex-1"><span className={cn('block text-xs font-medium', current ? candidate.review?.decision === 'passes' ? 'text-success' : 'text-warning' : 'text-ink-muted')}>{!current ? 'Review out of date' : candidate.review?.decision === 'passes' ? 'Checks passed' : 'Consider before baking'}</span>
                <p className="mt-0.5 text-2xs text-ink-subtle">Checked by Jev, an AI review made by TypeSafe AI.</p></div>
              <Button size="sm" disabled={editingDisabled} onClick={() => { void run('review') }}>Review again</Button></div>
          })()}<p className="text-2xs text-ink-subtle">{current ? 'Review the questions, then adjust the cut and framing. You decide when the clip is ready.' : 'These results describe an earlier edit. Run Jev again to check your changes.'}</p>{candidate.review?.questions.map((q) => <Question key={q.id} q={q} />)}{!candidate.review && <p className="text-xs text-ink-muted">No review is available yet. Run Jev to evaluate this candidate.</p>}{candidate.review?.cuts.map((cut, i) => <div key={i} className="space-y-1.5"><p className="editor-label">Removed {clock(cut.interval[0])} – {clock(cut.interval[1])}</p>{cut.questions.map((q) => <Question key={q.id} q={q} />)}</div>)}</div>}
          {tab === 'framing' && <fieldset disabled={editingDisabled} className="space-y-4">{pair ? <ScreenLayoutRow value={screenKind} share={screenShare} disabled={editingDisabled}
            onChoose={(kind) => setScreenLayout(kind)} onShare={(share) => { if (screenKind) setScreenLayout(screenKind, share) }} />
            : <div className="editor-layouts">{(['fill', 'split', 'fit'] as const).map((l) => <button key={l} className={cn(`layout-${l}`, currentScene.layout === l && 'selected')} onClick={() => setLayout(l)}><span aria-hidden className="editor-layout-dot" />{l === 'fill' ? 'Full frame' : l === 'split' ? 'Split' : 'Fit'}</button>)}</div>}{currentScene.layout === 'split' && !pair && <><div className="flex gap-2">{['Top', 'Bottom'].map((name, i) => <Button key={i} size="sm" variant={panel === i ? 'primary' : 'secondary'} onClick={() => setPanel(i)}>{name}</Button>)}</div>
            <div className="space-y-2 rounded-lg border border-white/10 p-2.5"><label className="editor-label">Split size <span className="float-right">Top {Math.round(topShare * 100)}% · Bottom {Math.round((1 - topShare) * 100)}%</span>
              <input aria-label="Split size" type="range" min={SPLIT_RANGE.min * 100} max={SPLIT_RANGE.max * 100} step={1} value={Math.round(topShare * 100)} onChange={(e) => setSplit(Number(e.target.value) / 100)} /></label>
              <div className="flex flex-wrap gap-1">{([['Bigger top', .6], ['Even', .5], ['Bigger bottom', .4]] as const).map(([label, value]) => <Button key={label} size="sm" variant={Math.abs(topShare - value) < .005 ? 'secondary' : 'ghost'} onClick={() => setSplit(value)}>{label}</Button>)}</div>
              <p className="text-2xs text-ink-subtle">Applies to this layout section. Use “Use layout for whole clip” to apply it everywhere.</p></div></>}{(currentScene.layout === 'fill' || currentScene.layout === 'split') && <><label className="editor-label">Zoom<input aria-label="Crop zoom" type="range" min={1} max={4} step={.02} value={Math.min(4, defaultCrop(project.width, project.height, panelAspect)[2] / crop[2])} onChange={(e) => cropChange(defaultCrop(project.width, project.height, panelAspect, crop[0] + crop[2] / 2, crop[1] + crop[3] / 2, Number(e.target.value)))} /></label>{([0, 1] as const).map((axis) => <label key={axis} className="editor-label">{axis === 0 ? 'Horizontal' : 'Vertical'}<input type="range" aria-label={axis === 0 ? 'Horizontal crop position' : 'Vertical crop position'} min={0} max={Math.max(0, 1 - crop[axis + 2])} step={.001} value={crop[axis]} onChange={(e) => { const c = [...crop] as Crop; c[axis] = Number(e.target.value); cropChange(c) }} /></label>)}</>}{sceneIndex > 0 && <div className="editor-motion"><label className="flex items-center justify-between gap-2 text-xs"><span>Smooth movement</span><input type="checkbox" aria-label="Smooth movement" checked={!!currentScene.transition_ms} disabled={!canAnimate || editingDisabled} onChange={(e) => sceneChange({ transition_ms: e.target.checked ? 600 : undefined })} /></label>{canAnimate && currentScene.transition_ms ? <label className="editor-label mt-3">Duration <span className="float-right">{(currentScene.transition_ms / 1000).toFixed(1)}s</span><input aria-label="Movement duration" type="range" min={100} max={5000} step={100} value={currentScene.transition_ms} onChange={(e) => sceneChange({ transition_ms: Number(e.target.value) })} /></label> : !canAnimate ? <p className="text-2xs text-ink-subtle mt-2">Use the same layout as the previous section to animate its crops.</p> : null}{!!currentScene.transition_ms && <Button size="sm" variant="ghost" onClick={() => { seek(Math.max(start, currentScene.at_ms)); void video.current?.play() }}>Preview movement</Button>}</div>}<div className="space-y-2 border-t border-white/10 pt-3"><div className="editor-layout-time">
            {sceneIndex > 0 ? <label className="flex items-center justify-between gap-3 text-xs"><span>Layout starts</span><TimeInput key={sceneIndex} label="Layout start" value={currentScene.at_ms} disabled={editingDisabled} onChange={(t) => moveScene(sceneIndex, t)} /></label>
              : <p className="text-2xs text-ink-muted">Initial layout</p>}
            {sceneIndex > 0 && frames.length > 0 && <div className="flex gap-2 mt-2"><Button size="sm" variant="ghost" disabled={editingDisabled} onClick={() => moveScene(sceneIndex, stepFrame(frames, currentScene.at_ms, -1))}>One frame earlier</Button><Button size="sm" variant="ghost" disabled={editingDisabled} onClick={() => moveScene(sceneIndex, stepFrame(frames, currentScene.at_ms, 1))}>One frame later</Button></div>}
            {sceneIndex + 1 < candidate.scenes.length && <p className="text-2xs text-ink-subtle mt-2">Until {clock(candidate.scenes[sceneIndex + 1].at_ms)}</p>}
          </div><Button size="sm" icon={<Scissors size={13} />} disabled={candidate.scenes.length >= 60 || time <= start || time >= end || candidate.scenes.some((s) => Math.abs(s.at_ms - time) < .01)} onClick={() => newLayout()}>New layout here</Button>{sceneIndex > 0 && <Button size="sm" variant="ghost" onClick={() => change({ scenes: candidate.scenes.filter((_, i) => i !== sceneIndex) })}>Remove layout change</Button>}<Button size="sm" variant="ghost" onClick={() => change({ scenes: [{ ...currentScene, at_ms: 0 }] })}>Use layout for whole clip</Button></div></fieldset>}
          {tab === 'captions' && <fieldset disabled={editingDisabled} className="space-y-4"><div className="flex items-center justify-between text-xs"><span>Burn in captions</span><Switch label="Burn in captions" checked={candidate.captions} onChange={(captions) => change({ captions })} /></div><p className="text-2xs text-ink-subtle">Captions follow your final cuts. Use the placement guide in Transcript to position them before baking.</p>{candidate.caption_language && candidate.captions && <p className="text-2xs text-ink-subtle">These captions are shown in {captionLanguageLabel(candidate.caption_language)}. Baking translates them again from the transcript (one request on your OpenRouter key).</p>}<CaptionSuppression key={candidate.id} ranges={suppressedCaptions} cuts={candidate.ranges} time={time} duration={project.duration_ms} disabled={editingDisabled || !candidate.captions} onChange={(caption_suppression_ranges) => { video.current?.pause(); change({ caption_suppression_ranges }) }} seek={seek} />{candidate.captions && <CaptionPresetPicker value={candidate.caption_preset} onChange={(caption_preset) => change({ caption_preset })} />}<EditorLookExtras value={candidate.look_extras} captions={candidate.captions} onChange={(look_extras) => change({ look_extras })} /><EditorSoundDesign value={candidate.sound} onChange={(sound) => change({ sound })} /><div className="flex items-center justify-between gap-3 border-t border-white/10 pt-3" data-testid="editor-color-grade"><div className="min-w-0"><p className="text-xs font-medium text-ink">Color grade</p><p className="text-2xs leading-snug text-ink-subtle">{COLOR_GRADE_INFO[candidate.grade ?? 'none'].detail} Your footage only: graphics, captions and text keep their colors. Applied when you bake.</p></div><ColorGradePicker value={candidate.grade} onChange={(grade) => change({ grade: grade === 'none' ? undefined : grade })} /></div><label className="editor-label">Export speed<select value={candidate.video_speed} onChange={(e) => change({ video_speed: Number(e.target.value) })}>{[1, 1.1, 1.25, 1.5, 1.75, 2].map((n) => <option key={n} value={n}>{n}×</option>)}</select></label>{styleButton}</fieldset>}
          {tab === 'hook' && <div className="space-y-4">
            <div><label className="editor-label" htmlFor="editor-title">Title</label><textarea id="editor-title" value={candidate.title} maxLength={200} disabled={editingDisabled} rows={2} onChange={(e) => { if (e.target.value.trim()) change({ title: e.target.value }) }} />
              <p className="text-2xs text-ink-subtle mt-1">The clip’s name in the editor and your Library.</p></div>
            <fieldset disabled={editingDisabled} className="space-y-3">
              <div className="flex items-center justify-between text-xs"><span>Hook text at the top</span>
                <Switch label="Hook text at the top" checked={!!candidate.hook}
                  onChange={(on) => change({ hook: on ? { text: candidate.title.slice(0, MAX_HOOK_CHARS), look: DEFAULT_HEADLINE_LOOK } : null })} /></div>
              {project.aspect_ratio !== '9:16' && <p className="text-2xs text-ink-subtle">Hook text is drawn on vertical (9:16) clips only.</p>}
              {candidate.hook === undefined && <p className="text-2xs text-ink-subtle">This project was made before hook text could be edited, so baked clips have none. <button className="underline" onClick={() => change({ hook: { text: candidate.title.slice(0, MAX_HOOK_CHARS), look: DEFAULT_HEADLINE_LOOK } })}>Add hook text</button></p>}
              {candidate.hook && <>
                <label className="editor-label" htmlFor="editor-hook">Words <span className="float-right">{candidate.hook.text.length} / {MAX_HOOK_CHARS}</span></label>
                <textarea id="editor-hook" aria-label="Hook text" rows={3} maxLength={MAX_HOOK_CHARS} value={candidate.hook.text}
                  onChange={(e) => { const text = e.target.value.replace(/\s+/g, ' '); if (text.trim() && candidate.hook) change({ hook: { ...candidate.hook, text } }) }} />
                {candidate.hook.text.trim().split(/\s+/).length < 2 && <p className="text-2xs text-warning">Use at least two words: a single word isn’t drawn.</p>}
                <HeadlineLookPicker compact value={candidate.hook.look} onChange={(look) => candidate.hook && change({ hook: { ...candidate.hook, look } })} />
                <p className="text-2xs text-ink-subtle">The Output preview shows roughly where it sits. Bake the clip again to apply it.</p>
              </>}
            </fieldset>
            <section className="space-y-2 border-t border-white/10 pt-3" aria-label="Hook ideas">
              <div className="flex items-center justify-between gap-2"><p className="text-xs">Hook ideas</p>
                <Button size="sm" icon={<Sparkles size={13} />} disabled={editingDisabled || !spoken} onClick={() => { void suggestHooks() }}
                  tooltip={spoken ? 'Write 5 hook options from what is said in this clip, each graded with the hook framework. Uses your OpenRouter key.' : 'Nothing is said in this clip, so there are no words to write hooks from.'}>{ideas ? 'Suggest again' : 'Suggest hooks'}</Button></div>
              {!ideas && <p className="text-2xs text-ink-subtle">Ideas only use what the speaker says in this clip. Picking one sets the hook words.</p>}
              {ideas && !ideas.length && <p className="text-2xs text-ink-subtle">No ideas stuck closely enough to what is said in this clip. Try again, or write your own.</p>}
              {ideas?.map((idea, i) => <div key={i} className="editor-hook-idea">
                <div className="flex items-start gap-2"><span className={cn('editor-hook-grade', `grade-${idea.grade.toLowerCase()}`)} title={`Hook score ${idea.score} of 10`}>{idea.grade}</span>
                  <p className="flex-1 text-xs leading-relaxed">{idea.text}</p></div>
                <p className="text-2xs text-ink-subtle">{hookTypeLabels[idea.hook_type] ?? 'Plain'} hook · {idea.score} / 10{idea.why ? ` · ${idea.why}` : ''}</p>
                {idea.evidence && <p className="text-2xs text-ink-subtle">From the clip: “{idea.evidence}”</p>}
                <Button size="sm" variant={candidate.hook?.text === idea.text ? 'secondary' : 'ghost'} disabled={editingDisabled || candidate.hook?.text === idea.text}
                  onClick={() => change({ hook: { text: idea.text, look: candidate.hook?.look ?? runHookLook(edits) } })}>{candidate.hook?.text === idea.text ? 'In use' : 'Use this hook'}</Button>
              </div>)}
            </section>
            <section className="space-y-2 border-t border-white/10 pt-3" aria-label="Call to action">
              <p className="text-xs">Call to action at the end</p>
              <Segmented label="Call to action" size="sm" value={typeof candidate.cta_id === 'string' || ctaPicking ? 'pick' : candidate.cta_id === null ? 'none' : 'run'}
                onChange={(mode) => { setCtaPicking(mode === 'pick'); if (mode === 'run') change({ cta_id: undefined }); else if (mode === 'none') change({ cta_id: null }) }}
                options={[{ value: 'run', label: 'Same as the run' }, { value: 'none', label: 'None' }, { value: 'pick', label: 'Choose' }]} />
              {(typeof candidate.cta_id === 'string' || ctaPicking) && <CtaPicker value={typeof candidate.cta_id === 'string' ? candidate.cta_id : null} disabled={editingDisabled}
                onChange={(id) => { if (id) change({ cta_id: id }) }}
                // A call to action deleted from the library: back to the run's, without an undo step.
                onMissing={() => { setCtaPicking(false); change({ cta_id: undefined }, false) }} />}
              {ctaPicking && typeof candidate.cta_id !== 'string' && <p className="text-2xs text-ink-subtle">Until you choose one, this clip uses the run’s call to action.</p>}
              <p className="text-2xs text-ink-subtle">Added to the end when you bake this clip. A clip you already baked can change its call to action in the Library (⋯ → Change call to action).</p>
            </section>
            {styleButton}
          </div>}
          {tab === 'transcript' && <section className="editor-subtitle-controls" aria-label="Subtitle placement">
            <div className="flex items-center justify-between gap-2 text-xs"><span>Subtitle placement guide</span><Switch label="Show subtitle guide" checked={showSubtitlePreview} onChange={setShowSubtitlePreview} /></div>
            {!candidate.captions ? <p className="text-2xs text-ink-muted">Subtitles are off for this clip. <button className="underline" disabled={editingDisabled} onClick={() => change({ captions: true })}>Enable subtitles</button></p>
              : <p className="text-2xs text-ink-subtle">Drag “Captions go here” up or down to choose where your subtitles sit. This position applies throughout the clip.</p>}
            <fieldset disabled={editingDisabled || !candidate.captions}>
              <label className="editor-label">Vertical position <span className="float-right">{candidate.caption_y == null ? 'Automatic' : `${Math.round(captionPosition * 100)}% from top`}</span>
                <input aria-label="Subtitle vertical position" type="range" min={10} max={90} step={1} value={Math.max(10, Math.min(90, captionPosition * 100))} onChange={e => moveCaption(Number(e.target.value) / 100)} />
              </label>
              <div className="flex gap-1 flex-wrap">{([['Top', .2], ['Middle', .5], ['Bottom', .8]] as const).map(([label, y]) => <Button key={label} variant="ghost" size="sm" onClick={() => moveCaption(y)}>{label}</Button>)}
                <Button variant="ghost" size="sm" disabled={candidate.caption_y == null} onClick={() => change({ caption_y: null })}>Automatic</Button></div>
            </fieldset>
          </section>}
          {tab === 'transcript' && <div className="editor-transcript"><p className="text-2xs text-ink-subtle">Caption edits apply to this clip. To make a new clip, select lines with the boxes (click, then Shift-click or drag).</p>
            {lines && <div className="editor-line-bar" role="group" aria-label="Selected lines">
              <p className="text-xs">{lines.last - lines.first + 1} line{lines.last === lines.first ? '' : 's'} selected{lineRange ? ` · ${clock(lineRange[0])} – ${clock(lineRange[1])} (${((lineRange[1] - lineRange[0]) / 1000).toFixed(1)}s)` : ''}</p>
              {lineRange && project.transcript[lines.last].end_ms > lineRange[1] && <p className="text-2xs text-warning">Clips can be up to {TRANSCRIPT_CLIP_MS.max / 60000} minutes, so the clip ends at the last whole line that fits.</p>}
              {lineRange && lineRange[1] - lineRange[0] > project.transcript[lines.last].end_ms - project.transcript[lines.first].start_ms + 1 && <p className="text-2xs text-ink-subtle">Clips are at least {TRANSCRIPT_CLIP_MS.min / 1000} seconds, so it runs a little past these lines.</p>}
              {full && <p className="text-2xs text-warning">This project has {MAX_EDITOR_CANDIDATES} clips, the most it can hold.</p>}
              <div className="flex flex-wrap gap-2"><Button size="sm" variant="primary" icon={<Plus size={13} />} disabled={!!busy || !lineRange || full} onClick={makeClip}
                tooltip="Add a new clip covering these lines, framed like the nearest clip. No AI is used.">Make a clip from these lines</Button>
                <Button size="sm" variant="ghost" onClick={() => setLines(null)}>Clear</Button></div>
            </div>}
            {project.transcript.map((r, i) => {
            const nearClip = r.end_ms >= start - 15000 && r.start_ms <= end + 15000
            const nearPlayhead = r.end_ms >= time - 15000 && r.start_ms <= time + 15000
            if (!nearClip && !nearPlayhead && editingCaption !== i) return null
            const edited = candidate.caption_edits?.some((e) => e.segment === i)
            const outside = !candidate.ranges.some(([a, b]) => r.start_ms < b && r.end_ms > a)
            return <div key={i} ref={r === activeTranscript ? activeCaption : undefined} aria-current={r === activeTranscript ? 'true' : undefined}
              className={cn('editor-transcript-row', r === activeTranscript && 'selected', outside && 'outside-cut', lines && i >= lines.first && i <= lines.last && 'line-selected')}
              title={outside ? 'Not in this clip’s cut' : undefined}>
              <div className="editor-transcript-time"><button className="editor-line-select" aria-label={`Select line at ${clock(r.start_ms)}`} aria-pressed={!!lines && i >= lines.first && i <= lines.last}
                title="Select this line for a new clip · Shift-click or drag to select several"
                onPointerDown={(e) => { if (e.button !== 0) return; e.preventDefault(); lineDrag.current = true; selectLine(i, e.shiftKey) }}
                onPointerEnter={() => { if (lineDrag.current) selectLine(i, true) }}
                onClick={(e) => { if (e.detail === 0) selectLine(i, e.shiftKey) }}>{lines && i >= lines.first && i <= lines.last && <Check size={9} />}</button><button onClick={() => seek(r.start_ms)} title="Playhead to this line">{formatTimecode(r.start_ms)}</button>{edited && <span>Edited</span>}
                <Button variant="ghost" size="sm" iconOnly icon={<Pencil size={12} />} aria-label={`Edit caption at ${clock(r.start_ms)}`} tooltip="Correct this caption’s text for the selected clip." disabled={!canEditCaption(i)} onClick={() => editCaption(i)} />
              </div>
              {editingCaption === i ? <><textarea ref={captionInput} aria-label={`Caption at ${clock(r.start_ms)}`} maxLength={2000} rows={3} value={captionText(i)} disabled={editingDisabled}
                onChange={(e) => { updateCaption(i, e.target.value, firstCaptionChange.current); firstCaptionChange.current = false }}
                onKeyDown={(e) => { if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); setEditingCaption(null) } }} />
                <div className="flex items-center justify-between mt-2"><Button size="sm" variant="ghost" disabled={editingDisabled || !edited} onClick={() => updateCaption(i, r.text)}>Reset text</Button><Button size="sm" onClick={() => setEditingCaption(null)}>Done</Button></div></>
                : <button className="editor-transcript-text" onClick={() => seek(r.start_ms)}>{captionText(i).trim() || <em>Caption hidden</em>}</button>}
            </div>
          })}{!project.transcript.length && <p>No spoken transcript is available for this source.</p>}</div>}
          {tab === 'chat' && <ClipChat outputDir={outputDir} candidate={candidate} apply={applyChat} undo={undoChat} play={(at, seconds) => playMoment(at, seconds, true)}
            playheadMs={time} selectedGraphic={candidate.graphics?.find((g) => g.id === graphicId) ?? null} autoSend={chatAuto}
            disabledReason={busy ? 'Wait for the current task to finish to chat about this clip.' : status === 'discarded' ? 'Restore this clip to chat about it.' : null} />}
          {tab === 'graphics' && <GraphicsInspector project={project} candidate={candidate} outputDir={outputDir} time={time} selected={graphicId} words={clipWords}
            disabled={editingDisabled} onGallery={() => openGallery(time)} onSuggest={suggestGraphics} onSelect={selectGraphic} onChange={setGraphics} seek={seek} clock={clipClock} />}

        </div>
      </aside>
    </div>
    {showAudit && <EditInspector outputDir={outputDir} onClose={() => setShowAudit(false)} />}
    {gallery !== null && <GraphicGallery templates={GRAPHIC_TEMPLATES} style={graphicStyle(candidate)} full={(candidate.graphics?.length ?? 0) >= graphicCap}
      limitNote={`A clip can have up to ${graphicCap} graphics. Remove one to add another.`}
      where={(() => { const words = clipWords.filter((w) => w.end_ms > gallery - 150).slice(0, 5).map((w) => w.word).join(' '); return `at ${clipClock(gallery)}${words ? `, on “${words}…”` : ''}` })()}
      prefill={(template) => prefillGraphic(template, clipWords, gallery, { line: project.transcript.find((r) => gallery >= r.start_ms && gallery < r.end_ms)?.text, until: end }).fields}
      prefillEffect={(effect) => prefillEffect(effect, clipWords, gallery, { line: project.transcript.find((r) => gallery >= r.start_ms && gallery < r.end_ms)?.text, until: end }).fields}
      looks pictures onPick={insertGraphic} onLogo={insertLogo} onClose={() => setGallery(null)} />}
  </section>
}
/** Where the preview draws a clip's hook text (vertical clips with at least two words, like the export). */
function previewHook(ctx: CanvasRenderingContext2D, c: CandidateEdit, width: number, height: number): { bar: string | null; barH: number; size: number; lines: string[]; top: number; lineH: number; family: string } | null {
  const hook = c.hook
  if (!hook || hook.look.look === 'none' || height <= width || hook.text.trim().split(/\s+/).length < 2) return null
  const font = HEADLINE_FONTS.find((f) => f.id === hook.look.font)
  const bar = headlineBarColor(hook.look), size = Math.round(width * 0.058), family = font?.family ?? 'sans-serif'
  ctx.font = `800 ${size}px ${family}`
  const lines: string[] = []
  for (const word of (font?.upper ? hook.text.toUpperCase() : hook.text).split(' ')) {
    const last = lines.at(-1)
    if (last !== undefined && ctx.measureText(`${last} ${word}`).width < width * 0.86) lines[lines.length - 1] = `${last} ${word}`
    else lines.push(word)
  }
  const shown = lines.slice(0, 3), top = Math.round(height * 0.035), lineH = Math.round(size * 1.18)
  return { bar, barH: bar ? top * 2 + shown.length * lineH : 0, size, lines: shown, top, lineH, family }
}
function CaptionSuppression({ ranges, cuts, time, duration, disabled, onChange, seek }: {
  ranges: EditorRange[]; cuts: EditorRange[]; time: number; duration: number; disabled: boolean
  onChange: (ranges: EditorRange[]) => void; seek: (t: number) => void
}): React.JSX.Element {
  const at = Math.round(time)
  const nextRange = nextCaptionRange(ranges, cuts, at)
  const canAdd = !disabled && nextRange !== null
  const update = (i: number, edge: 0 | 1, value: number): void => onChange(trimRange(ranges, i, edge, value, duration))
  return <section className="space-y-3 border-t border-white/10 pt-3" aria-label="Caption suppression">
    <h3 className="text-xs font-medium">Caption-free sections{ranges.length > 0 && <span className="ml-2 text-ink-subtle">{ranges.length}</span>}</h3>
    <p className="text-2xs text-ink-subtle">Already captioned in the source? Suppress our captions during those sections. Video, audio and source captions stay intact. Times refer to the source video.</p>
    <Button size="sm" disabled={!canAdd} onClick={() => {
      if (!nextRange) return
      onChange([...ranges, nextRange].sort((a, b) => a[0] - b[0])); seek(nextRange[0])
    }}>{ranges.length ? 'Add another section' : 'Suppress captions here'}</Button>
    {ranges.length > 0 && <p className="text-2xs text-ink-subtle">{!nextRange ? ranges.length >= 200 ? 'Section limit reached. Remove a section to add another.' : 'Captions are suppressed throughout the selected footage. Shorten or remove a section to make room.' : 'Add as many sections as you need. Each has its own start and end. New sections start at the playhead or the next available spot in this clip.'}</p>}
    {!ranges.length && <p className="text-2xs text-ink-subtle">Seek to a section, add a range, then adjust its start and end.</p>}
    {ranges.map(([a, b], i) => <div key={i} className="editor-caption-range">
      <div className="flex items-center justify-between gap-2"><button className="text-2xs text-ink-muted" onClick={() => seek(a)}>Section {i + 1}</button><Button size="sm" variant="ghost" iconOnly icon={<X size={12} />} tooltip="Restore captions in this section by removing its suppression range." aria-label={`Remove caption-free section ${i + 1}`} disabled={disabled} onClick={() => onChange(ranges.filter((_, j) => j !== i))} /></div>
      <div className="flex flex-wrap items-end gap-2">{([0, 1] as const).map((edge) => <label key={edge} className="text-2xs text-ink-subtle">{edge === 0 ? 'Start' : 'End'}<TimeInput label={`Caption-free section ${i + 1} ${edge === 0 ? 'start' : 'end'}`} value={edge === 0 ? a : b} disabled={disabled} onChange={(t) => update(i, edge, t)} /></label>)}</div>
      <div className="flex flex-wrap gap-2 mt-2"><Button size="sm" variant="ghost" disabled={disabled || at < (ranges[i - 1]?.[1] ?? 0) || at > b - 100} onClick={() => update(i, 0, at)}>Start at playhead</Button><Button size="sm" variant="ghost" disabled={disabled || at < a + 100 || at > (ranges[i + 1]?.[0] ?? duration)} onClick={() => update(i, 1, at)}>End at playhead</Button></div>
    </div>)}
  </section>
}
function TimeInput({ label, value, disabled, onChange }: { label: string; value: number; disabled: boolean; onChange: (v: number) => void }): React.JSX.Element {
  const [text, setText] = useState(clock(value))
  useEffect(() => setText(clock(value)), [value])
  const commit = (): void => {
    if (text === clock(value)) return
    const n = parseTimecode(text)
    setText(clock(value))
    if (n !== null && Number.isFinite(n)) onChange(n * 1000)
  }
  return <input className="editor-time-input" aria-label={label} value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
}
function trimDrag(e: React.PointerEvent<HTMLButtonElement>, index: number, edge: 0 | 1, viewStart: number, viewEnd: number, duration: number, c: EditorCandidate, edits: EditorCandidate[], selected: number, setEdits: React.Dispatch<React.SetStateAction<EditorCandidate[]>>, setUndo: React.Dispatch<React.SetStateAction<EditorCandidate[][]>>, setRedo: React.Dispatch<React.SetStateAction<EditorCandidate[][]>>, onDone: () => void): void {
  e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId)
  const target = e.currentTarget, bounds = target.parentElement!.parentElement!.getBoundingClientRect(), pointerStart = e.clientX
  setUndo((u) => [...u.slice(-49), edits]); setRedo([])
  const move = (event: PointerEvent): void => {
    const t = c.ranges[index][edge] + (event.clientX - pointerStart) / bounds.width * (viewEnd - viewStart)
    const ranges = trimRange(c.ranges, index, edge, t, duration)
    setEdits((items) => items.map((item, i) => i === selected ? refineEdit(item, { ranges }) : item))
  }
  const done = (): void => { target.removeEventListener('pointermove', move); target.removeEventListener('lostpointercapture', done); onDone() }
  target.addEventListener('pointermove', move); target.addEventListener('lostpointercapture', done)
}
