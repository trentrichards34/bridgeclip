import { useEffect, useMemo, useRef, useState } from 'react'
import { FirstRunGuide } from '../components/FirstRunGuide'
import { AlertTriangle, Camera, Check, Image as ImageIcon, Copy, FileText, Film, FolderOpen, Library, Send, Sparkles, UserRound, Wand2, X } from 'lucide-react'
import type { AvatarSummary } from '../../shared/avatars'
import { REACTIONS } from '../../shared/avatars'
import {
  brandCtaKeyword, ctaLine, estimateRemixCost, isRunning, MAX_POST_CAPTION_CHARS, MAX_SOURCES,
  closeWithoutCta, heygenBadge, lipsyncProblem, normalizeCtaKeyword, AVATAR_VOICE, REMIX_ANGLES, REMIX_HOSTS, REMIX_ORDERS, REMIX_PRICES, REMIX_VOICES, remixPriceNote,
  REMIX_WORD_LIMITS, remixEditProblem, remixSourceUrl, STANCE_LABELS, STYLE_LABELS, wordCount,
  AI_CARDS, CAMERA_CARDS, clipFormat, remixMode, headlineOnly, CAMERA_LAYOUTS, partsFor, AVATAR_REACTIONS_BETA, type CameraSettings, type FormatCard, type FormatCardId,
  type RemixFormat, type RemixMode, type RemixRecordings, type BrandIdentity, type RemixDraft, type RemixEdit, type RemixHost, type RemixOutput, type RemixStatus
} from '../../shared/remix'
import type { Page as PageName } from '../components/Sidebar'
import { VoicePreview } from '../components/VoicePreview'
import { previewFrame, StyleBoard } from '../components/StyleBoard'
import { SkillsPanel } from '../components/SkillsPanel'
import { PurposeFields } from '../components/PurposeFields'
import { remixSkillPatch, remixSkillRows } from '../../shared/skills'
import { boardFromLook, LOOK_HOOKS, lookPatch } from '../lib/style-board'
import { partLabel, RemixRecorder } from '../components/RemixRecorder'
import { PauseReactReview } from '../components/PauseReactReview'
import { MomentTakeReview } from '../components/MomentTakeReview'
import { ClipTakeReview } from '../components/ClipTakeReview'
import { CLIP_MAX_SECONDS, longClipNote } from '../../shared/react-templates'
import { defaultTheirCaptions, HOOK_AT_LABELS, PART1_CHOICES, THEIR_CAPTION_CHOICES, type RemixLayoutChoice } from '../../shared/remix-layouts'
import { MomentRanges } from '../components/MomentRanges'
import { RemixLookSection } from '../components/RemixReviewLook'
import { formatTimecode, MOMENT_TAKE_MAX_SECONDS, readRanges } from '../../shared/moment-take'
import { PAUSE_CAPTION_CHOICES, PAUSE_LAYOUTS, PAUSE_REACT_MAX_SECONDS, type PauseLayout } from '../../shared/pause-react'
import { CAPTION_PRESETS } from '../../shared/caption-presets'
import { HEADLINE_LOOKS, type HeadlineLookStyle } from '../../shared/headline-look'
import { FriendlyError } from '../components/FriendlyError'
import { useLowDiskGate } from '../components/LowDiskGate'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Callout } from '../components/ui/Callout'
import { Checkbox } from '../components/ui/Checkbox'
import { EmptyState } from '../components/ui/EmptyState'
import { Field, TextArea, TextInput } from '../components/ui/Field'
import { Page } from '../components/ui/Page'
import { PageHeader } from '../components/ui/PageHeader'
import { Panel, PanelHeader } from '../components/ui/Panel'
import { ChoiceCards, LookCard, lookColors, MakerAside, MakerLayout, MakerSection, onCardRadioKeyDown } from '../components/maker/Maker'
import { FormatDiagram } from '../components/maker/FormatDiagram'
import { ProgressBar } from '../components/ui/ProgressBar'
import { onRadioKeyDown, Segmented } from '../components/ui/Segmented'
import { Select } from '../components/ui/Select'
import { SettingRow } from '../components/ui/SettingRow'
import { Switch } from '../components/ui/Switch'
import { getApi } from '../lib/ipc'
import { requestSettingsSection } from '../lib/settings-focus'
import { cn, errorMessage, localFileUrl } from '../lib/utils'
import { brollSourceProblem, type BrollSource } from '../../shared/broll-library'
import { useBrollContext } from '../store/use-broll-library-store'
import { BrollSourcePicker } from '../components/BrollSourcePicker'
import { useSettingsStore } from '../store/use-settings-store'
import { useRemixForm, type RemixForm } from '../store/use-remix-form-store'
import { useBrands } from '../store/use-brand-store'
import { BrandPicker } from '../components/BrandIdentityDialog'
import { brandFormPatch, hasBrandMark } from '../../shared/brand-kit'
import { StylePresets } from '../components/StylePresets'
import { PostDialog, type PostableClip } from '../components/PostDialog'
import { toPostable } from '../components/ClipList'
import { clipFilePath } from '../lib/thumbnails'
import { parseJobOutput } from '../../shared/job-output'
import { isAvatarStudioEnabled } from '../../shared/features'

const COUNTS = [1, 3, 5, 10] as const
/** On camera, Zoom is a Skill (in the Skills list): not also in the look board's Extras. */
const REMIX_SKILL_EXTRAS = ['punch_zoom'] as const
/** "Look & call to action" stays open or closed for the rest of the session once the member chooses. */
let lookOpenThisSession = false
/** Switching between "You on camera" and "AI presenter" comes back to the template last picked on each side. */
const lastPick: { camera: FormatCardId; ai: { format: RemixFormat; host: RemixHost } } = { camera: 'pause_react', ai: { format: 'commentary', host: 'still' } }

/** Links pasted one per line (or separated by spaces). */
export function parseLinks(value: string): { links: string[]; invalid: string[] } {
  const items = [...new Set(value.split(/\s+/).map((item) => item.trim()).filter(Boolean))]
  return { links: items.filter((item) => remixSourceUrl(item)), invalid: items.filter((item) => !remixSourceUrl(item)) }
}

/** Where a missing piece is filled in: "Show me" scrolls there and marks it. */
type FieldTarget = 'keys' | 'source' | 'creator' | 'ranges' | 'promises' | 'presenter' | 'look'
interface Blocker { text: string; target: FieldTarget }

const GRADE_TONES: Record<string, string> = {
  A: 'bg-emerald-400 text-black', B: 'bg-lime-300 text-black', C: 'bg-amber-300 text-black', D: 'bg-orange-400 text-black', F: 'bg-red-500 text-white'
}

/** Voice only picked by this page because no avatar existed yet; kept across restarts so it can be undone once one does. */
const AUTO_VOICE_KEY = 'creatorclips.remix.autoVoiceOnly'
const autoVoiceOnly = {
  get active(): boolean { try { return localStorage.getItem(AUTO_VOICE_KEY) !== null } catch { return false } },
  set active(on: boolean) { try { if (on) localStorage.setItem(AUTO_VOICE_KEY, this.voice || ''); else localStorage.removeItem(AUTO_VOICE_KEY) } catch { /* storage unavailable */ } },
  get voice(): string { try { return localStorage.getItem(AUTO_VOICE_KEY) ?? '' } catch { return '' } },
  set voice(id: string) { try { if (localStorage.getItem(AUTO_VOICE_KEY) !== null) localStorage.setItem(AUTO_VOICE_KEY, id) } catch { /* storage unavailable */ } }
}

export function RemixPage({ onNavigate, onViewLibrary }: { onNavigate: (page: PageName) => void; onViewLibrary?: (outputDir: string) => void }): React.JSX.Element {
  const openrouterConfigured = useSettingsStore((s) => s.openrouterConfigured)
  const pexelsConfigured = useSettingsStore((s) => s.pexelsConfigured)
  const heygenConfigured = useSettingsStore((s) => s.heygenConfigured)
  const form = useRemixForm()
  const [avatars, setAvatars] = useState<AvatarSummary[]>([])
  // The avatar list has been read (an empty list then means "no avatars yet", not "still loading").
  const [avatarsLoaded, setAvatarsLoaded] = useState(false)
  const brands = useBrands((s) => s.brands)
  const loadBrands = useBrands((s) => s.load)
  const [status, setStatus] = useState<RemixStatus | null>(null)
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lowDisk = useLowDiskGate()
  const [lookOpen, setLookOpenState] = useState(lookOpenThisSession)
  const setLookOpen = (open: boolean): void => { lookOpenThisSession = open; setLookOpenState(open) }
  // After Continue: bring the review (or progress) panel into view and move focus to its heading.
  const reviewRef = useRef<HTMLDivElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const [revealReview, setRevealReview] = useState(false)
  // While a review is open (or its hook text is being written or it's being made), the setup form folds away
  // behind "Start a new remix": the review has its own look and skills for that video.
  const [newRemixFor, setNewRemixFor] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    getApi().avatars.list().then((list) => { if (live) { setAvatars(list); setAvatarsLoaded(true) } }).catch(() => undefined)
    void loadBrands(true)
    getApi().remix.status().then((current) => { if (live && current) setStatus(current) }).catch(() => undefined)
    const off = getApi().remix.onStatus((next) => setStatus(next))
    return () => { live = false; off() }
  }, [loadBrands])

  useEffect(() => {
    if (!revealReview) return
    const panel = reviewRef.current
    if (!panel) return
    panel.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    const heading = panel.querySelector<HTMLElement>('h2, h3')
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }) }
    // Keep following it while the plan is written; stop once it's ready (or ended).
    if (status && status.phase !== 'planning') setRevealReview(false)
  }, [revealReview, status?.phase, status?.id])
  useEffect(() => { if (error) errorRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' }) }, [error])

  const avatar = avatars.find((item) => item.id === form.avatarId) ?? avatars[0] ?? null
  const brand = brands.find((item) => item.id === form.brandIdentityId) ?? null
  const busy = isRunning(status)
  const reviewing = status?.phase === 'review'
  const { links, invalid } = parseLinks(form.links)
  const silent = form.format === 'silent'
  // Voiced takes' b-roll: the member's pick when it can run, else My library when it has shots, else stock (or stills).
  const { usableShots: libraryShots } = useBrollContext()
  const pickedBroll = form.brollSource && !brollSourceProblem(form.brollSource, { libraryShots, pexels: pexelsConfigured, openrouter: openrouterConfigured }) ? form.brollSource : null
  const remixBrollSource: BrollSource | null = pickedBroll ?? (libraryShots > 0 ? 'library' : pexelsConfigured ? 'stock' : null)
  // "You on camera" (real-person templates) or "AI presenter" (Beta): the format and presenter decide which.
  const mode: RemixMode = remixMode(form.format, form.host)
  // Green screen over their video: React to a clip, you on camera, cut out in front of their moment.
  const greenScreen = silent && form.host === 'camera'
  const image = form.format === 'image'
  // Pause & react: you on camera; their video pauses whenever you talk.
  const pause = form.format === 'pause_react'
  // Moment + my take: one long video, your time ranges, the best moment in each, then you on camera.
  const momentTake = form.format === 'moment_take'
  // Their clip, then me / React, then my thoughts: one short clip, then you (React, then my thoughts: with your b-roll).
  const clip = clipFormat(form.format)
  // Formats that use one video: the link box asks for one.
  const singleVideo = pause || momentTake || clip
  const sources = image ? (form.imagePath ? [form.imagePath] : []) : form.filePath ? [form.filePath] : links
  // A chosen file's length, so ranges past its end are caught here (a link's is checked once it's fetched).
  const [fileSeconds, setFileSeconds] = useState<number | null>(null)
  useEffect(() => { setFileSeconds(null) }, [form.filePath])
  const longClip = form.format === 'clip_then_me' && form.filePath ? longClipNote(fileSeconds) : null
  // The reels' layouts: their captions (Instagram and TikTok clips have their own), the hook on the split line or beside you.
  const theirCaptions = form.theirCaptions ?? defaultTheirCaptions(form.filePath ? '' : links[0] ?? '')
  const splitHook = pause && form.pauseLayout === 'split'
  const phoneCard = form.format === 'react_thoughts' && form.reactPart1 === 'phone'
  const layoutChoice: RemixLayoutChoice | null = pause || clip ? {
    theirCaptions, part1: phoneCard ? 'phone' : 'box', hookAt: splitHook ? form.splitHook : phoneCard ? form.phoneHook : 'top'
  } : null
  const moments = readRanges(form.momentRanges, form.filePath ? fileSeconds : null)
  const rangeMinutes = moments.ranges.reduce((sum, range) => sum + range.endS - range.startS, 0) / 60
  // React to a clip (silent): the avatar's reactions, or the member's own. Over a screenshot, in a pause-and-react and in your take on a moment, it's always you.
  const host: RemixHost = image || pause || momentTake || clip ? 'camera' : silent ? (form.host === 'camera' ? 'camera' : 'still') : form.host
  const onCamera = host === 'camera'
  const needsAvatar = !onCamera && (silent || host !== 'voice')
  // The avatar's own voice (its clone or preset) unless a preset is picked here; voice-only can borrow it too.
  const usesAvatarVoice = form.voice === AVATAR_VOICE
  const showAvatars = !onCamera && (needsAvatar || usesAvatarVoice)
  // Avatar on camera (HeyGen, Beta): the chosen avatar must be a ready HeyGen avatar, on the member's HeyGen key.
  const lipsync = host === 'lipsync'
  const lipsyncIssue = lipsyncProblem(heygenConfigured, avatar)
  const readyHeygen = avatars.find((item) => lipsyncProblem(heygenConfigured, item) === null) ?? null
  // The card is off when no avatar can be used (the reason from the chosen avatar, or the first HeyGen one).
  const lipsyncOff = readyHeygen ? null : lipsyncProblem(heygenConfigured, avatar?.heygen ? avatar : avatars.find((item) => item.heygen) ?? null)
  const heygenVoice = lipsync && avatar?.heygen?.voice === 'heygen'
  const avatarVoiceName = avatar ? (heygenVoice ? `${avatar.name}’s HeyGen voice` : avatar.voice.provider === 'clone' ? `${avatar.name}’s cloned voice` : `${avatar.name}’s voice (${avatar.voice.voice})`) : 'Your avatar’s voice'
  const cost = momentTake ? estimateRemixCost('camera', Math.max(1, moments.ranges.length), rangeMinutes / 60, 'moment_take') : estimateRemixCost(host, form.count, 0.5, form.format)
  const reactionCount = avatar?.reactions?.length ?? 0
  const keyword = normalizeCtaKeyword(form.ctaKeyword)
  const brandKeyword = brand ? brandCtaKeyword(brand.text) : ''
  const block = (text: string, target: FieldTarget): Blocker => ({ text, target })
  const blocker: Blocker | null = !openrouterConfigured ? block('Add your OpenRouter key in Settings first', 'keys')
    : image ? (!form.imagePath ? block('Choose a screenshot of the article or post', 'source')
      : !form.creator.trim() ? block('Add where the screenshot is from, for the credit', 'creator')
        : keyword === null ? block('Use one word for the comment keyword, like SALES', 'look')
          : !form.clipRightsAck ? block('Confirm you’re allowed to share this screenshot', 'promises') : null)
    : sources.length === 0 ? block('Paste a video link or choose a file', 'source')
      : (pause || clip) && sources.length > 1 ? block('React to one video at a time: paste one link', 'source')
      : momentTake && sources.length > 1 ? block('Use one long video: paste one link', 'source')
      : sources.length > MAX_SOURCES ? block(`Up to ${MAX_SOURCES} videos per run`, 'source')
        : invalid.length > 0 && !form.filePath ? block('Fix the links that aren’t valid', 'source')
          : form.filePath && !form.creator.trim() ? block('Add the original creator’s name for the credit', 'creator')
            : silent && !onCamera && !avatar ? block('Create an avatar in Avatar Studio first', 'presenter')
            : silent && !onCamera && reactionCount === 0 ? block('Make this avatar’s reactions in Avatar Studio first', 'presenter')
            : silent && !form.clipRightsAck ? block('Confirm you’re allowed to use these clips', 'promises')
            : (pause || clip) && !form.clipRightsAck ? block('Confirm you’re allowed to use this video', 'promises')
            : momentTake && moments.problem ? block(moments.problem, 'ranges')
            : momentTake && !form.clipRightsAck ? block('Confirm you’re allowed to use this video', 'promises')
            : lipsync && lipsyncIssue ? block(lipsyncIssue.reason, 'presenter')
            : needsAvatar && !avatar ? block('Create an avatar in Avatar Studio, or use voice only', 'presenter')
              : !onCamera && usesAvatarVoice && !avatar ? block('Create an avatar in Avatar Studio, or pick a preset voice', 'presenter')
              : keyword === null ? block('Use one word for the comment keyword, like SALES', 'look')
              : !onCamera && !form.aiLabelAck ? block('Confirm you’ll turn on the AI label when you post', 'promises') : null

  // "Show me": bring the field that needs filling into view, focus it and mark it for a moment.
  const [attention, setAttention] = useState<FieldTarget | null>(null)
  useEffect(() => {
    if (!attention) return
    const timer = setTimeout(() => setAttention(null), 2000)
    return () => clearTimeout(timer)
  }, [attention])
  const revealField = (target: FieldTarget): void => {
    if (target === 'keys') { openKeys(); return }
    if (target === 'look') setLookOpen(true)
    setAttention(target)
    // After the look section has opened.
    requestAnimationFrame(() => {
      const box = document.querySelector<HTMLElement>(`[data-remix-field="${target}"]`)
      if (!box) return
      box.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
      const field = (target === 'look' ? box.querySelector<HTMLElement>('input[aria-label^="Comment keyword"]') : null)
        ?? box.querySelector<HTMLElement>('input:not([type="hidden"]):not(:disabled), textarea:not(:disabled), button[role="checkbox"], [role="radio"][aria-checked="true"]:not(:disabled), button:not(:disabled)')
      field?.focus({ preventScroll: true })
    })
  }
  const marked = (target: FieldTarget): string => cn('rounded-xl transition-shadow duration-300', attention === target && 'ring-2 ring-warning/70 ring-offset-4 ring-offset-canvas')

  const openKeys = (): void => { requestSettingsSection('keys'); onNavigate('settings') }

  const chooseImage = async (): Promise<void> => {
    setError(null)
    try {
      const path = await getApi().remix.selectImage()
      if (path) form.update({ imagePath: path })
    } catch (err) { setError(errorMessage(err, 'That screenshot could not be opened.')) }
  }

  const chooseFile = async (): Promise<void> => {
    setError(null)
    try {
      const path = await getApi().dialog.selectVideo()
      if (path) form.update({ filePath: path, links: '' })
    } catch (err) { setError(errorMessage(err, 'That video could not be opened.')) }
  }

  // Picking a different brand fills the style fields from its look (picking the same one again changes nothing).
  const chooseBrand = (next: BrandIdentity | null): void => {
    form.update({ brandIdentityId: next?.id ?? null, ...(next ? brandFormPatch(next.look, form) : {}) })
  }
  const showMark = hasBrandMark(brand?.look)

  const plan = async (): Promise<void> => {
    setError(null)
    setLaunching(true)
    try {
      // A nearly full drive asks first (and offers Free up space).
      if (!(await lowDisk.ensureSpace())) return
      const started = await getApi().remix.start({
        sources, creator: sources.length === 1 ? form.creator : '', angle: form.angle, order: form.order, host,
        avatarId: showAvatars ? avatar?.id ?? null : null, voice: form.voice, brandIdentityId: brand?.id ?? null, count: form.count,
        captionPreset: form.captionPreset, includeCaptions: form.includeCaptions, aiLabelAck: form.aiLabelAck,
        ctaKeyword: keyword ?? '', ctaOffer: keyword ? form.ctaOffer.trim() : '', format: form.format, clipRightsAck: (silent || image || pause || momentTake || clip) && form.clipRightsAck,
        headlineLook: form.headlineLook,
        ...(form.lookExtras.length ? { lookExtras: form.lookExtras } : {}),
        ...(onCamera ? { camera: image ? { ...form.imageCamera, talk: true } : pause ? { ...form.pauseCamera, layout: form.pauseCamera.layout === 'greenscreen' ? 'filmed' : form.pauseCamera.layout, talk: true }
          : momentTake || clip ? { ...form.momentCamera, layout: form.momentCamera.layout === 'greenscreen' ? 'filmed' : form.momentCamera.layout, talk: true }
          // Green screen over their video: always the green screen (React, then my thoughts films you behind a box).
          : silent ? { ...form.camera, layout: 'greenscreen' as const, talk: form.camera.talk } : { ...form.camera, talk: false } } : {}),
        ...(pause ? { pause: { layout: form.pauseLayout, captions: form.pauseCaptions } } : {}),
        ...(layoutChoice ? { layout: layoutChoice } : {}),
        ...(momentTake ? { moment: { ranges: moments.ranges, pip: form.momentPip } } : {}),
        ...(form.ctaId ? { ctaId: form.ctaId } : {}),
        ...(brand && showMark && form.showHandle ? { showHandle: true } : {}),
        // Skills (you on camera): music and voice cleanup.
        ...(onCamera && form.music ? { music: true, ...(form.musicTrack ? { musicTrack: form.musicTrack } : {}) } : {}),
        ...(onCamera && form.voiceCleanup ? { voiceCleanup: true } : {}),
        // "Say what it's for".
        ...(form.purpose.trim() ? { purpose: form.purpose.replace(/\s+/g, ' ').trim() } : {}),
        ...(form.reference ? { referenceImage: form.reference.id } : {}),
        // Voiced takes: where the beats' b-roll comes from (none picked and no library: stock or stills, as before).
        ...(form.format === 'commentary' && remixBrollSource ? { brollSource: remixBrollSource } : {})
      })
      setStatus((previous) => previous?.id === started.id && previous.phase !== 'planning' ? previous : started)
      setRevealReview(true)
    } catch (err) { setError(errorMessage(err, 'The remixes could not be started.')) }
    finally { setLaunching(false) }
  }

  // The template cards: you on camera (the real-person templates) or the AI presenter's (Beta).
  const formatCards: readonly FormatCard[] = mode === 'camera' ? CAMERA_CARDS : AI_CARDS
  const formatSelected = (id: FormatCardId): boolean => id === 'greenscreen' ? greenScreen
    : id === 'commentary' || id === 'silent' ? form.format === id && (mode === 'camera') === (form.host === 'camera') : form.format === id
  const pickFormat = (id: FormatCardId): void => {
    if (formatSelected(id)) return
    if (mode === 'camera') lastPick.camera = id
    if (id === 'greenscreen') {
      form.update({ format: 'silent', host: 'camera', camera: { ...form.camera, layout: 'greenscreen', talk: true }, clipRightsAck: silent ? form.clipRightsAck : false })
      return
    }
    form.update({
      format: id,
      // Each kind has its own permission promise (clips vs. a screenshot).
      clipRightsAck: id === 'silent' && silent ? form.clipRightsAck : false,
      // A scripted take on camera: you read the lines (one take to record to start with).
      ...(id === 'commentary' && mode === 'camera' ? { host: 'camera' as const, ...(form.host !== 'camera' || form.format !== 'commentary' ? { count: 1 } : {}) } : {})
    })
    if (mode === 'ai') lastPick.ai = { format: id as RemixFormat, host: form.host }
  }
  const pickMode = (next: RemixMode): void => {
    if (next === mode) return
    if (next === 'ai') {
      lastPick.camera = greenScreen ? 'greenscreen' : form.format
      const host = lastPick.ai.host === 'camera' ? 'still' : lastPick.ai.host
      form.update({ format: lastPick.ai.format, host, clipRightsAck: false })
      return
    }
    lastPick.ai = { format: form.format, host: form.host }
    const card = lastPick.camera
    if (card === 'greenscreen') form.update({ format: 'silent', host: 'camera', camera: { ...form.camera, layout: 'greenscreen', talk: true }, clipRightsAck: false })
    else form.update({ format: card, ...(card === 'commentary' ? { host: 'camera' as const, count: 1 } : {}), clipRightsAck: false })
  }
  // Avatar Studio switched off (shared/features): no "AI presenter" side (its avatars are made there), so a remembered
  // AI presenter choice opens on "You on camera" instead.
  const aiPresenter = isAvatarStudioEnabled()
  useEffect(() => {
    if (aiPresenter || mode !== 'ai') return
    const current = useRemixForm.getState()
    const card = lastPick.camera
    if (card === 'greenscreen') current.update({ format: 'silent', host: 'camera', camera: { ...current.camera, layout: 'greenscreen', talk: true }, clipRightsAck: false })
    else current.update({ format: card, ...(card === 'commentary' ? { host: 'camera' as const, count: 1 } : {}), clipRightsAck: false })
  }, [aiPresenter, mode])
  // The AI presenter with no avatar yet: Avatar photo and "Your avatar's voice" can't be used, so it starts on
  // Voice only with a preset voice (only when the side opens, so a choice made here stays).
  const noAvatars = avatarsLoaded && avatars.length === 0
  useEffect(() => {
    if (mode !== 'ai' || !avatarsLoaded) return
    const current = useRemixForm.getState()
    if (!noAvatars) {
      // An avatar now exists: undo the stand-in this page chose (not a choice the member made).
      if (autoVoiceOnly.active && current.host === 'voice' && current.voice === autoVoiceOnly.voice) current.update({ host: 'still', voice: AVATAR_VOICE })
      autoVoiceOnly.active = false
      return
    }
    const patch: Partial<RemixForm> = {
      ...(current.host === 'still' || current.host === 'lipsync' ? { host: 'voice' as const } : {}),
      ...(current.voice === AVATAR_VOICE ? { voice: REMIX_VOICES[0].id } : {})
    }
    if (Object.keys(patch).length) {
      current.update(patch)
      autoVoiceOnly.active = patch.host === 'voice'
      autoVoiceOnly.voice = patch.voice ?? current.voice
    }
  }, [noAvatars, avatarsLoaded, mode])
  // The AI presenter's voiced take: avatar photo or voice only (its clip reactions are always the avatar's).
  const hostChoice = mode === 'ai' && !silent
  const cameraValue = image ? form.imageCamera : pause ? form.pauseCamera : momentTake || clip ? form.momentCamera : form.camera
  const setupFolded = status !== null && (reviewing || (busy && status.drafts.length > 0)) && newRemixFor !== status.id
  const takeWaiting = reviewing && status !== null && (oneTakeRun(status) ? status.drafts.some((draft) => Boolean(draft.quote || draft.headline)) : status.drafts.length > 0)
  // Section numbers: the video, who's in it, the format, (AI presenter) the presenter, the look and call to action, then the rest.
  // (Without the AI presenter, "Who’s in it" isn't asked: the format comes second.)
  const lookStep = (onCamera ? 4 : 5) - (aiPresenter ? 0 : 1)
  const goStep = lookStep + 1

  const modePanel = (
    <ChoiceCards<RemixMode> label="Who is in the video" value={mode} onChange={pickMode} options={[
      { value: 'camera', label: 'You on camera', detail: 'You react, talk or give your take. Record here or upload a phone video.' },
      { value: 'ai', label: 'AI presenter', tag: 'Beta', detail: 'Your avatar or an AI voice presents the take. An early version.',
        // With no avatar yet, the AI presenter says so on its card, with the way to make one.
        footer: noAvatars ? (
          <p className="px-3.5 pb-3 text-2xs text-warning" data-testid="ai-needs-avatar">
            Needs an avatar ·{' '}
            <button type="button" className="font-medium text-tool hover:underline" onClick={() => onNavigate('avatar')}>Make one</button>
          </p>
        ) : undefined }
    ]} />
  )

  const formatPanel = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4" role="radiogroup" aria-label="Remix format">
        {formatCards.map((item) => {
          const selected = formatSelected(item.id)
          return (
            <button key={item.id} type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1} onKeyDown={onCardRadioKeyDown}
              onClick={() => pickFormat(item.id)}
              className={cn('glass-tile glass-tile-hover flex flex-col rounded-[13px] p-2 text-left', selected ? 'glass-selected text-ink' : 'text-ink-muted hover:text-ink')}>
              <span className="flex h-24 items-center justify-center rounded-[9px] bg-sidebar"><FormatDiagram format={item.id} mode={mode} /></span>
              <span className="block px-0.5 pt-2 text-xs font-semibold text-ink">{item.label}</span>
              <span className={cn('block px-0.5 pb-0.5 pt-0.5 text-2xs leading-snug', selected ? 'text-ink-muted' : 'text-ink-subtle')}>{item.detail}</span>
            </button>
          )
        })}
      </div>
        {form.format === 'clip_then_me' ? (
          <p className="text-2xs text-ink-muted">
            For a reel, a Short, a TikTok or any short clip. You choose the part (up to {CLIP_MAX_SECONDS / 60} minutes) and record your take, here or on your phone. The video plays their clip first, framed for vertical with its captions, then you full screen. The AI writes the hook text and caption from what you said, and you can edit both.
          </p>
        ) : form.format === 'react_thoughts' ? (
          <p className="text-2xs text-ink-muted">
            Part 1: their clip plays in a big box with its own sound while you watch and react behind it. Part 2: you share your thoughts full screen, and your own clips and pictures (or stock footage) cut in over what you say. Record both parts here or upload phone videos. The AI writes the hook text and caption from what you said and places your b-roll; you can change all of it.
          </p>
        ) : momentTake ? (
          <p className="text-2xs text-ink-muted">
            For each range, the AI listens to just that part and picks its strongest 5–25 second moment, cut on whole sentences. You check it (nudge its start and end, or ask for another), then record your take on it, here or on your phone. Each video opens with the moment, then you. The AI writes the hook text and caption from what you said, and you can edit both.
          </p>
        ) : pause ? (
          <p className="text-2xs text-ink-muted">
            Their video plays in a box while you’re the main picture. Whenever you talk it pauses on a held frame, and it plays on when you stop. Record here (press Space to pause it) or upload a phone recording where you paused it yourself. The AI writes the hook text and caption from what you said.
          </p>
        ) : image ? (
          <p className="text-2xs text-ink-muted">
            You record yourself talking about the screenshot, here or on your phone. Then the AI turns what you said into the hook text and the caption with your call to action, and you can edit both before the video is made.
          </p>
        ) : greenScreen ? (
          <p className="text-2xs text-ink-muted">
            The AI picks complete 10–45 second moments and writes the hook text and caption. Then you film yourself reacting to each one you keep, here or on your phone: their moment fills the screen with its sound, and you’re cut out in front of it.
          </p>
        ) : silent ? (
          <p className="text-2xs text-ink-muted">
            The AI picks complete 10–45 second moments, writes the hook text above the clip, and writes the caption with your take and call to action. Your avatar’s reactions (watching, nodding, pointing, laughing) are timed to what’s said. {AVATAR_REACTIONS_BETA}
          </p>
        ) : (
          // The style of the written take: a choice inside the format, so it's labeled and kept quieter than the format cards.
          <div className="space-y-2.5 border-t border-white/[0.06] pt-4">
            <div>
              <span className="block text-sm font-medium text-ink" id="remix-take-style">Style of your take</span>
              <span className="block text-2xs text-ink-subtle">How the AI writes {onCamera ? 'your lines' : 'the take'}. You can edit every line before anything is made.</span>
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-labelledby="remix-take-style">
              {REMIX_ANGLES.map((angle) => {
                const selected = form.angle === angle.id
                return (
                  <button key={angle.id} type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1} onKeyDown={onRadioKeyDown}
                    onClick={() => form.update({ angle: angle.id })} title={angle.example}
                    className={cn('rounded-lg border px-2.5 py-1.5 text-left transition-colors',
                      selected ? 'border-tool/50 bg-tool/10 text-ink' : 'border-white/[0.06] bg-white/[0.02] text-ink-muted hover:border-white/[0.12] hover:text-ink')}>
                    <span className="block text-xs font-medium">{angle.label}</span>
                    <span className={cn('block text-2xs', selected ? 'text-ink-muted' : 'text-ink-subtle')}>{onCamera ? angle.cameraDescription ?? angle.description : angle.description}</span>
                  </button>
                )
              })}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="block text-xs font-medium text-ink">Order</span>
                <span className="block text-2xs text-ink-subtle">{(() => { const order = REMIX_ORDERS.find((item) => item.id === form.order); return onCamera ? order?.cameraDetail : order?.detail })()}</span>
              </div>
              <Segmented label="Order" size="sm" value={form.order} onChange={(order) => form.update({ order })}
                options={REMIX_ORDERS.map((order) => ({ value: order.id, label: order.label }))} />
            </div>
          </div>
        )}
    </div>
  )

  const sourceTitle = image ? 'The article or post' : clip ? 'Their clip' : pause ? 'The video you react to' : momentTake ? 'The long video and your times' : 'The videos'
  const sourceHelp = image
    ? 'A screenshot of the article, post, tweet or headline you want to talk about. A long screenshot scrolls behind you as you talk.'
    : clip ? `Paste one link to a reel, Short or TikTok (or any video), or choose a file. From the Library, use ⋯ → Remix this clip. You choose the part next, up to ${CLIP_MAX_SECONDS / 60} minutes.`
      : pause ? 'Paste one public video link or choose a file. From the Library, use ⋯ → Remix this clip. You can trim it to the part you react to next.'
        : momentTake ? 'Paste one long video (a podcast or an interview) or choose a file; from the Library, use ⋯ → Remix this clip. Then add the times you noted while listening.'
          : `Any public videos with a moment worth reacting to. Paste one link per line, up to ${MAX_SOURCES}.`
  const sourcePanel = (
    <div>
      <div className="space-y-3">
        <div data-remix-field="source" className={marked('source')}>
        {image ? (
          form.imagePath ? (
            <div className="glass-tile flex items-center gap-3 rounded-xl px-3 py-2.5">
              <img src={localFileUrl(form.imagePath)} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover object-top" />
              <span className="min-w-0 flex-1 truncate text-sm text-ink" title={form.imagePath}>{form.imagePath.split(/[\\/]/).pop()}</span>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void chooseImage()}>Change</Button>
            </div>
          ) : (
            <Button variant="secondary" icon={<ImageIcon className="h-4 w-4" />} disabled={busy} onClick={() => void chooseImage()}>Choose a screenshot</Button>
          )
        ) : form.filePath ? (<>
          <div className="glass-tile flex items-center gap-3 rounded-xl px-3 py-2.5">
            <Film className="h-4 w-4 shrink-0 text-ink-muted" />
            <span className="min-w-0 flex-1 truncate text-sm text-ink" title={form.filePath}>{form.filePath.split(/[\\/]/).pop()}</span>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => form.update({ filePath: null })}>Use links instead</Button>
          </div>
          {form.sourceBurnedIn === form.filePath && (
            <Callout tone="warning" className="mt-2" data-testid="remix-burned-in">
              This clip already has its own hook text and captions, and its original video is no longer in your Library, so they’ll show in your remix.
              {form.headlineLook.look !== 'none' && <> To avoid two hooks, turn yours off. <button type="button" className="underline" onClick={() => form.update({ headlineLook: { ...form.headlineLook, look: 'none' } })}>Turn off my hook text</button></>}
            </Callout>
          )}
        </>) : (
          <div className="space-y-1.5">
            {/* One-video formats ask for one link; the others take a list. */}
            <div className="flex items-start gap-2">
              <TextArea rows={singleVideo ? 1 : 3} value={form.links} aria-label="Video links" className={cn('min-h-[44px] flex-1 font-mono text-[13px]', singleVideo && 'resize-none')}
                placeholder={singleVideo ? 'Paste a public YouTube, TikTok or Instagram link' : 'Paste public video links, one per line'}
                onChange={(e) => form.update({ links: e.target.value })} />
              <Button size="lg" variant="secondary" className="h-11" icon={<Film className="h-4 w-4" />} disabled={busy} onClick={() => void chooseFile()}>Or choose a file</Button>
            </div>
            <span className={cn('block text-2xs', invalid.length || (singleVideo && links.length > 1) ? 'text-danger' : 'text-ink-subtle')} data-testid="link-count">
              {invalid.length ? `Not a full link: ${invalid[0].slice(0, 60)}${invalid.length > 1 ? ` and ${invalid.length - 1} more` : ''}`
                : singleVideo ? (links.length === 0 ? 'One video link' : links.length === 1 ? '1 video' : `${links.length} links: this kind uses one video`)
                : links.length === 0 ? `One link per line, up to ${MAX_SOURCES}` : `${links.length} video${links.length === 1 ? '' : 's'}`}
            </span>
          </div>
        )}
        <p className="mt-1.5 text-2xs text-ink-subtle">{sourceHelp}</p>
        </div>
        {momentTake && (
          <div data-remix-field="ranges" className={marked('ranges')}>
            <MomentRanges value={form.momentRanges} lengthSeconds={form.filePath ? fileSeconds : null} disabled={busy} onChange={(momentRanges) => form.update({ momentRanges })} />
          </div>
        )}
        {(momentTake || clip) && form.filePath && (
          <video src={localFileUrl(form.filePath)} preload="metadata" muted className="hidden" aria-hidden="true"
            onLoadedMetadata={(e) => { const seconds = e.currentTarget.duration; if (Number.isFinite(seconds) && seconds > 0) setFileSeconds(seconds) }} />
        )}
        {longClip && (
          <Callout tone="info" action={<Button size="sm" variant="secondary" onClick={() => pickFormat('moment_take')}>Use Moment + my take</Button>}>{longClip}</Callout>
        )}
        {momentTake && form.filePath && fileSeconds !== null && <p className="text-2xs text-ink-subtle">This video is {formatTimecode(fileSeconds)} long.</p>}
        {image ? (
          <div data-remix-field="creator" className={marked('creator')}>
            <Field label="Where it’s from" hint="Required. Shown on screen as “Source: …” and in the caption, e.g. the publication or the account.">
              <TextInput value={form.creator} maxLength={80} placeholder="e.g. The Wall Street Journal or @handle" onChange={(e) => form.update({ creator: e.target.value })} />
            </Field>
          </div>
        ) : sources.length <= 1 && (
          // A link fills in its creator; a file can't, so then it's required (and says so).
          <div data-remix-field="creator" className={marked('creator')}>
            <Field label={form.filePath ? 'Original creator (required)' : 'Original creator (optional)'}
              hint={form.filePath ? 'Required: who made this video. A file doesn’t say, and their name is shown on screen while their moment plays.' : 'Shown on screen while their moment plays. Filled in from the link when left blank.'}>
              <TextInput value={form.creator} maxLength={80} placeholder="e.g. @theircreator" aria-label="Original creator" onChange={(e) => form.update({ creator: e.target.value })} />
            </Field>
          </div>
        )}
        <p className="text-2xs text-ink-subtle">
          Your own video? Use Clip for straight clips.{' '}
          <button type="button" className="font-medium text-tool hover:underline" onClick={() => onNavigate('clip')}>Go to Clip</button>
        </p>
      </div>
    </div>
  )

  const brandBlock = <BrandPicker value={form.brandIdentityId} onChange={chooseBrand} noneDetail="A neutral expert voice, no results or numbers" />

  // What the comment keyword does here, under the board's keyword fields.
  const keywordHelp = (
    <div className="space-y-1">
      <p className="text-2xs text-ink-subtle">Turns viewers into DMs: every video ends with it, it shows on screen, and it closes the caption. Deliver what you promise with an auto-DM tool like ManyChat.</p>
      {keyword === null ? <p className="text-2xs text-danger">One word: letters, numbers or a dash (2–20 characters).</p>
        : keyword && form.ctaId ? <p className="text-2xs text-ink-muted">Your CTA clip plays at the end of every video (so the presenter doesn’t say one too), and the caption ends with: <span className="text-ink">“{ctaLine(keyword, form.ctaOffer)}”</span></p>
        : keyword ? (silent || image || pause || momentTake || clip
          ? <p className="text-2xs text-ink-muted">“Comment {keyword}” shows on screen at the end, and the caption ends with: <span className="text-ink">“{ctaLine(keyword, form.ctaOffer)}”</span></p>
          : <p className="text-2xs text-ink-muted">Every video ends with: <span className="text-ink">“{ctaLine(keyword, form.ctaOffer)}”</span></p>)
          : brandKeyword ? (
            <button type="button" className="text-2xs text-tool" onClick={() => form.update({ ctaKeyword: brandKeyword })}>
              Use “{brandKeyword}” from your Brand Identity
            </button>
          ) : <p className="text-2xs text-ink-subtle">Leave it empty to end on the payoff (or your Brand Identity’s own call to action).</p>}
    </div>
  )
  // The member's frame behind the board's preview: the screenshot, their file, or a YouTube link's thumbnail.
  const frame = image ? previewFrame(form.imagePath, 'image') : form.filePath ? previewFrame(form.filePath) : previewFrame(links[0])
  const styleBoard = (layout?: React.ReactNode): React.JSX.Element => (
    <StyleBoard value={boardFromLook(form)} onChange={(patch) => form.update(lookPatch(form, patch))}
      rows={{ hooks: LOOK_HOOKS, handle: true, cta: true, keyword: true, extras: true }} brand={brand} frame={frame} saveKind="remix"
      keywordHelp={keywordHelp} keywordLabel="Comment keyword (optional)"
      ctaHelp="A short video of you (or an image) played at the end of every video. It replaces the presenter’s spoken call to action. You can change it on any video afterward in the Library."
      onUseBrand={() => { if (brand) form.update({ ...brandFormPatch(brand.look, form), ...(brand.look?.captionPreset ? { includeCaptions: true } : {}) }) }}
      layout={layout} skillExtras={onCamera ? REMIX_SKILL_EXTRAS : undefined} />
  )

  const pauseLayoutChoice = pause && (
    <div className="space-y-2">
      <span className="block text-sm text-ink">Where their video goes</span>
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Where their video goes">
        {PAUSE_LAYOUTS.map((item) => {
          const selected = form.pauseLayout === item.id
          return (
            <button key={item.id} type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1} onKeyDown={onRadioKeyDown}
              onClick={() => form.update({ pauseLayout: item.id })}
              className={cn('glass-tile glass-tile-hover rounded-xl px-3 py-2.5 text-left', selected ? 'glass-selected text-ink' : 'text-ink-muted hover:text-ink')}>
              <span className="block text-xs font-medium">{item.label}</span>
              <span className={cn('block text-2xs', selected ? 'text-ink-muted' : 'text-ink-subtle')}>{item.detail}</span>
            </button>
          )
        })}
      </div>
    </div>
  )

  const cameraBlock = onCamera && <CameraOptions mode={image ? 'image' : pause ? 'pause' : momentTake || clip ? 'moment' : silent ? 'silent' : 'take'}
    value={cameraValue}
    onChange={(camera) => form.update(image ? { imageCamera: camera } : pause ? { pauseCamera: camera } : momentTake || clip ? { momentCamera: camera } : { camera })} />

  const pipRow = momentTake && (
    <SettingRow title="Keep the moment small on screen while I talk"
      description={form.momentPip ? 'The moment loops without sound in a box at the top while you give your take.' : 'Off: you fill the screen after the moment.'}
      control={<Switch label="Keep the moment small on screen while I talk" checked={form.momentPip} onChange={(momentPip) => form.update({ momentPip })} />} />
  )

  // Pause & react: whose words the captions show (a layout choice, under the board).
  const pauseCaptionsRow = form.includeCaptions && pause && (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span>
        <span className="block text-sm text-ink">Whose words</span>
        <span className="block text-2xs text-ink-subtle">{PAUSE_CAPTION_CHOICES.find((item) => item.id === form.pauseCaptions)?.detail}</span>
      </span>
      <Segmented label="Whose words" size="sm" value={form.pauseCaptions} onChange={(pauseCaptions) => form.update({ pauseCaptions })}
        options={PAUSE_CAPTION_CHOICES.map((item) => ({ value: item.id, label: item.label }))} />
    </div>
  )

  // React, then my thoughts: how their clip shows while you react silently (and, as a phone card, where the hook goes).
  const part1Choice = form.format === 'react_thoughts' && (
    <div className="space-y-2">
      <span className="block text-sm text-ink">While you react</span>
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="While you react">
        {PART1_CHOICES.map((item) => {
          const selected = form.reactPart1 === item.id
          return (
            <button key={item.id} type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1} onKeyDown={onRadioKeyDown}
              onClick={() => form.update({ reactPart1: item.id })}
              className={cn('glass-tile glass-tile-hover rounded-xl px-3 py-2.5 text-left', selected ? 'glass-selected text-ink' : 'text-ink-muted hover:text-ink')}>
              <span className="block text-xs font-medium">{item.label}</span>
              <span className={cn('block text-2xs', selected ? 'text-ink-muted' : 'text-ink-subtle')}>{item.detail}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
  // Where the hook text goes: on the split line (Pause & react, split) or beside you (phone card); else at the top.
  const hookPlace = splitHook ? form.splitHook : phoneCard ? form.phoneHook : null
  const hookPlaceRow = hookPlace && form.headlineLook.look !== 'none' && (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span>
        <span className="block text-sm text-ink">Where the hook text goes</span>
        <span className="block text-2xs text-ink-subtle">{HOOK_AT_LABELS[hookPlace].detail}</span>
      </span>
      <Segmented label="Where the hook text goes" size="sm" value={hookPlace}
        onChange={(value) => form.update(splitHook ? { splitHook: value as 'seam' | 'top' } : { phoneHook: value as 'beside' | 'top' })}
        options={(splitHook ? ['seam', 'top'] as const : ['beside', 'top'] as const).map((id) => ({ value: id, label: HOOK_AT_LABELS[id].label }))} />
    </div>
  )
  // Their clip's own captions: left alone (ours start when you talk). Only matters when their words would be captioned.
  const theirCaptionsRow = form.includeCaptions && (clip || (pause && form.pauseCaptions === 'both')) && (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span>
        <span className="block text-sm text-ink">Their clip already has captions</span>
        <span className="block text-2xs text-ink-subtle">{THEIR_CAPTION_CHOICES.find((item) => item.id === theirCaptions)?.detail}</span>
      </span>
      <Segmented label="Their clip already has captions" size="sm" value={theirCaptions} onChange={(value) => form.update({ theirCaptions: value })}
        options={THEIR_CAPTION_CHOICES.map((item) => ({ value: item.id, label: item.label }))} />
    </div>
  )
  // Their clip, then me: the reels show their clip full frame with no hook bar; "No hook text" is a fine choice here.
  const clipHookNote = form.format === 'clip_then_me' && form.headlineLook.look !== 'none' && (
    <p className="text-2xs text-ink-subtle">
      Tip: <button type="button" className="text-tool hover:underline" onClick={() => form.update({ headlineLook: { ...form.headlineLook, look: 'none' } })}>No hook text</button> lets their clip fill the whole frame, like most “their clip, then me” reels. The hook text is still your video’s title in the Library.
    </p>
  )

  // (You on camera is the other side of the first choice: here, only the AI presenters.)
  const hostCards = hostChoice && (
    <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Presenter">
      {REMIX_HOSTS.filter((item) => item.id !== 'camera').map((item) => {
        const selected = form.host === item.id
        // Off: the reason is said once, in the note under the cards (with its button); the card gets a short status.
        const off = item.id === 'lipsync' && !selected ? lipsyncOff : null
        const unavailable = off?.reason
        // Choosing it picks a ready HeyGen avatar when the chosen one isn't.
        const choose = (): void => {
          form.update({ host: item.id, ...(item.id === 'lipsync' && lipsyncIssue && readyHeygen ? { avatarId: readyHeygen.id } : {}) })
          lastPick.ai = { format: form.format, host: item.id }
        }
        return (
          <button key={item.id} type="button" role="radio" aria-checked={selected} aria-disabled={unavailable ? true : undefined}
            tabIndex={selected ? 0 : -1} onKeyDown={onRadioKeyDown} disabled={Boolean(unavailable)} title={unavailable}
            onClick={choose}
            className={cn('glass-tile rounded-xl px-3 py-2.5 text-left', unavailable ? 'cursor-not-allowed opacity-50' : 'glass-tile-hover',
              selected ? 'glass-selected text-ink' : 'text-ink-muted hover:text-ink')}>
            <span className="flex flex-wrap items-center gap-1.5 text-xs font-medium">{item.label}
              {item.beta && <Badge tone="warning">Beta</Badge>}{off && <Badge>{off.status}</Badge>}</span>
            <span className={cn('block text-2xs', selected ? 'text-ink-muted' : 'text-ink-subtle')}>{item.detail}</span>
            {item.beta && <span className="mt-0.5 block text-2xs text-ink-subtle">{item.beta}</span>}
          </button>
        )
      })}
    </div>
  )
  // Why Avatar on camera can't be used (or can't be used with this avatar), with the place it's fixed.
  const lipsyncIssueShown = lipsync ? lipsyncIssue : lipsyncOff
  const lipsyncNote = hostChoice && lipsyncIssueShown && (
    <Callout tone="info" title={lipsync ? 'Avatar on camera needs a ready HeyGen avatar' : 'Avatar on camera (HeyGen, Beta) isn’t ready'}
      action={lipsyncIssueShown.fix === 'settings'
        ? <Button size="sm" onClick={openKeys}>Open Settings</Button>
        : <Button size="sm" onClick={() => onNavigate('avatar')}>Open Avatar Studio</Button>}>
      {lipsyncIssueShown.reason}
    </Callout>
  )
  // HeyGen makes the avatar's lines on the member's own HeyGen account.
  const lipsyncCostNote = hostChoice && lipsync && !lipsyncIssue && (
    <p className="text-2xs text-ink-muted">
      {heygenVoice && form.voice === AVATAR_VOICE
        ? 'HeyGen makes every line in your avatar’s HeyGen voice; the opening and closing lines show your avatar on camera.'
        : 'HeyGen lip-syncs your avatar to the voice for the opening and closing lines.'}{' '}
      HeyGen bills it on your HeyGen account (estimated here at HeyGen’s published price of ${REMIX_PRICES.avatarPerSecond.toFixed(2)} per second of video).
      Making a video on HeyGen can take several minutes.
    </p>
  )

  const avatarBlocks = (<>
    {showAvatars && (avatars.length === 0 ? (
      <EmptyState icon={<UserRound />} title="No avatars yet" description="Create one in Avatar Studio from your photo, then come back."
        action={<Button size="sm" onClick={() => onNavigate('avatar')}>Open Avatar Studio</Button>} />
    ) : (
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6" role="radiogroup" aria-label="Avatar">
        {avatars.map((item) => {
          // A HeyGen avatar still training (or waiting on consent) says so, and can't present a lip-synced take yet.
          const badge = heygenBadge(item.heygen)
          const off = lipsync && lipsyncProblem(heygenConfigured, item) !== null
          return (
            <button key={item.id} type="button" role="radio" aria-checked={avatar?.id === item.id} tabIndex={avatar?.id === item.id ? 0 : -1}
              onKeyDown={onRadioKeyDown} onClick={() => form.update({ avatarId: item.id })} disabled={off} aria-disabled={off || undefined}
              title={off ? lipsyncProblem(heygenConfigured, item)?.reason : undefined}
              className={cn('glass-tile relative overflow-hidden rounded-xl text-left', off ? 'cursor-not-allowed opacity-50' : 'glass-tile-hover', avatar?.id === item.id && 'glass-selected')}>
              <img src={localFileUrl(item.portraitPath)} alt="" className="aspect-[9/16] w-full object-cover" />
              {badge && <span className="absolute left-1.5 top-1.5 rounded-full bg-black/70"><Badge tone="warning">{badge}</Badge></span>}
              <span className="block truncate px-2 py-1 text-2xs font-medium text-ink">{item.name}{lipsync && item.heygen ? ' · HeyGen' : ''}</span>
            </button>
          )
        })}
      </div>
    ))}
    {silent && !onCamera && avatar && (reactionCount > 0
      ? <p className="text-2xs text-ink-muted">{reactionCount} of 6 reactions ready for {avatar.name}. More reactions make the video feel more natural.</p>
      : <Callout tone="info" title={`${avatar.name} has no reactions yet`} action={<Button size="sm" onClick={() => onNavigate('avatar')}>Open Avatar Studio</Button>}>
          Make them once in Avatar Studio (AI from the picture, about $2.50, or upload your own short clips), then come back.
        </Callout>)}
    {!silent && !onCamera && <Field label="Voice">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Select value={form.voice} searchable onChange={(voice) => form.update({ voice })}
            options={[{ value: AVATAR_VOICE, label: avatarVoiceName, detail: heygenVoice ? 'Set in Avatar Studio · HeyGen speaks your lines' : 'Set in Avatar Studio · clone your voice there' },
              ...REMIX_VOICES.map((voice) => ({ value: voice.id, label: voice.label, detail: voice.detail }))]} />
        </div>
        {(!usesAvatarVoice || avatar) && (
          <VoicePreview
            request={usesAvatarVoice && avatar ? { kind: 'avatar', voice: avatar.voice, avatarId: avatar.id } : { kind: 'avatar', voice: { provider: 'elevenlabs', voice: form.voice } }}
            name={usesAvatarVoice ? avatarVoiceName : form.voice} />
        )}
      </div>
    </Field>}
  </>)

  const rightsBox = (checked: boolean, label: string, text: string): React.JSX.Element => (
    <div className="flex items-start gap-2">
      <Checkbox checked={checked} onChange={(clipRightsAck) => form.update({ clipRightsAck })} label={label} className="mt-px" />
      <span aria-hidden="true" className="cursor-pointer select-none text-xs text-ink-muted" onClick={() => form.update({ clipRightsAck: !form.clipRightsAck })}>{text}</span>
    </div>
  )
  const promises = (<div data-remix-field="promises" className={cn('space-y-4', marked('promises'))}>
    {image && rightsBox(form.clipRightsAck, "I'm allowed to share this screenshot",
      'I’m allowed to share this screenshot, and I’m commenting on it: it’s public, my own, or shared with permission. The video credits where it’s from.')}
    {momentTake && rightsBox(form.clipRightsAck, "I'm allowed to use this video",
      'I’m allowed to use this video and I’m commenting on it: it’s my own, an affiliate’s, or from a creator who allows clips. Each video opens with a short moment of it, with its sound, and credits the creator on screen.')}
    {clip && rightsBox(form.clipRightsAck, "I'm allowed to use this video",
      `I’m allowed to use this video and I’m reacting to it: it’s my own, an affiliate’s, or from a creator who allows reactions. ${form.format === 'react_thoughts' ? 'React, then my thoughts' : 'Their clip, then me'} plays the part I choose with its sound, and credits the creator on screen.`)}
    {pause && rightsBox(form.clipRightsAck, "I'm allowed to use this video",
      'I’m allowed to use this video and I’m reacting to it: it’s my own, an affiliate’s, or from a creator who allows reactions. Pause & react plays much of it with its sound, and credits the creator on screen.')}
    {silent && rightsBox(form.clipRightsAck, "I'm allowed to use these clips",
      'I’m allowed to use these clips: my own, an affiliate’s, or a creator who openly allows clipping. React to a clip plays up to 45 seconds of their video with its sound.')}
    {!onCamera && <div className="flex items-start gap-2">
      <Checkbox checked={form.aiLabelAck} onChange={(aiLabelAck) => form.update({ aiLabelAck })} label="I'll turn on the AI-content label when I post" className="mt-px" />
      <span aria-hidden="true" className="cursor-pointer select-none text-xs text-ink-muted" onClick={() => form.update({ aiLabelAck: !form.aiLabelAck })}>
        I’ll turn on the platform’s AI-content label when I post these. TikTok, YouTube and Instagram require it for AI presenters and voices.
      </span>
    </div>}
  </div>)

  const countRow = !image && !pause && !momentTake && !clip && (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span>
        <span className="block text-sm text-ink">Takes per long video</span>
        <span className="block text-2xs text-ink-subtle">A reel, TikTok or Short (up to 3 minutes) always gets one take{silent ? ' that reacts to the whole video' : ''}.</span>
      </span>
      <Segmented label="Takes per video" size="sm" value={String(form.count)} onChange={(value) => form.update({ count: Number(value) })}
        options={COUNTS.map((count) => ({ value: String(count), label: String(count) }))} />
    </div>
  )

  const goLabel = image || pause || clip ? 'Continue to recording' : momentTake ? 'Find the moments' : onCamera && !silent ? 'Write and record' : 'Write the takes'
  // What happens next and what it costs, under the button.
  const nextSteps = momentTake
        ? `Next the AI listens to your ranges${rangeMinutes ? ` (${Math.round(rangeMinutes * 10) / 10} min in all)` : ''} and picks a moment in each, you record your take on each one (up to ${MOMENT_TAKE_MAX_SECONDS / 60} minutes), and the AI writes each video’s hook text and caption from what you said. ${momentCost(cost.perRemixLow * Math.max(1, moments.ranges.length), cost.total)} Reading a time from a screenshot is charged when you add it, and shown there.`
        : clip
        ? `Next you choose the part of their clip and record ${form.format === 'react_thoughts' ? 'both parts' : 'your take'} (up to ${CLIP_MAX_SECONDS / 60} minutes each), here or on your phone. Then the AI writes the hook text and caption from what you said${form.format === 'react_thoughts' ? ' and places your b-roll' : ''} (about $${cost.perRemixLow.toFixed(2)}–$${cost.perRemixHigh.toFixed(2)}). You can change it all before the video is made.`
        : image
        ? 'Next you record yourself talking about it, then the AI writes the hook text and caption from your words (about $0.02). You can edit both before the video is made.'
        : pause
        ? `Next you choose the part of their video and record yourself reacting to it (up to ${PAUSE_REACT_MAX_SECONDS / 60} minutes), here or on your phone. Then the AI writes the hook text and caption from what you said (about $${cost.perRemixLow.toFixed(2)}–$${cost.perRemixHigh.toFixed(2)}). You can edit both before the video is made.`
        : onCamera
        ? silent
          ? `The AI finds the moments and writes the hook text and caption (about $${REMIX_PRICES.sourcePerHour.toFixed(2)} per hour of video). Then you film your reaction to each one you keep, and making them is free.`
          : `The AI finds the moments and writes and grades a take for each (about $${REMIX_PRICES.sourcePerHour.toFixed(2)} per hour of video). You edit the lines, read them on camera from a teleprompter, and making them costs about $0.01 each for captions.`
        : silent
        ? `The AI finds the moments, writes the hook text and caption, and times the reactions (about $${REMIX_PRICES.sourcePerHour.toFixed(2)} per hour of video). You review them, and making them is free: your reactions are reused.`
        : `First the AI finds the moments and writes and grades a take for each (about $${REMIX_PRICES.sourcePerHour.toFixed(2)} per hour of video). You review and edit them, and only the ones you approve are made: ${cost.perRemixHigh - cost.perRemixLow < 0.01 ? `about $${cost.perRemixHigh.toFixed(2)}` : `about $${cost.perRemixLow.toFixed(2)}–$${cost.perRemixHigh.toFixed(2)}`} each.`
  const detailsPanel = (
    <div className="space-y-4">
      <PurposeFields purpose={form.purpose} onPurpose={(purpose) => form.update({ purpose })} reference={form.reference} onReference={(reference) => form.update({ reference })}
        disabled={launching} purposeHelp="The AI uses it to write the hook text and caption. It’s never shown in the video."
        onUseLook={(picked) => form.update({ captionPreset: picked.captionPreset, includeCaptions: true, headlineLook: { ...form.headlineLook, color: picked.color, look: 'brand' } })} />
      {countRow}
      {form.format === 'commentary' && (
        <div className="glass-tile rounded-2xl p-3">
          <BrollSourcePicker value={form.brollSource} current={remixBrollSource} onChange={(brollSource) => form.update({ brollSource })} disabled={launching}
            onOpenLibrary={() => onNavigate('broll')} emptyText="Stills: add clips to your B-roll library or a free Pexels key for moving b-roll under the voice-over." />
        </div>
      )}
      {promises}
    </div>
  )
  const currentCard = formatCards.find((item) => formatSelected(item.id)) ?? formatCards[0]
  const goPanel = (
    <MakerAside label={`Preview · ${currentCard.label}`}>
      <div className="mt-3"><FormatDiagram format={currentCard.id} mode={mode} size="lg" /></div>
      <h2 className="mt-4 font-display text-[17px] font-semibold text-ink">{currentCard.label}</h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{currentCard.detail}.</p>
      <Button variant="primary" size="lg" className="mt-4 h-12 w-full rounded-[13px] font-display text-[15px] font-semibold"
        icon={image || pause || clip ? <Camera className="h-4 w-4" /> : momentTake ? <Sparkles className="h-4 w-4" /> : <Wand2 className="h-4 w-4" />} loading={launching} disabled={launching || busy || blocker !== null}
        tooltip={busy ? 'A remix run is in progress' : undefined} onClick={() => void plan()}>
        {goLabel}
      </Button>
      {/* What's still missing, said under the button (not only in its tooltip), with the way to it. */}
      {blocker && !busy && (
        <p className="mt-2 flex min-w-0 flex-wrap items-center justify-center gap-x-1.5 text-center text-xs text-ink-muted" data-testid="remix-blocker" role="status">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
          <span>{/[.!?]$/.test(blocker.text) ? blocker.text : `${blocker.text}.`}</span>
          <button type="button" className="font-medium text-tool hover:underline" onClick={() => revealField(blocker.target)}>
            {blocker.target === 'keys' ? 'Open API keys' : 'Show me'}
          </button>
        </p>
      )}
      {takeWaiting && <p className="mt-2 text-center text-2xs text-ink-subtle">Starting again replaces the {image || pause || clip ? 'take' : momentTake ? 'moments' : 'takes'} waiting for review above.</p>}
      <p className="mt-3 text-2xs leading-relaxed text-ink-subtle">{nextSteps}</p>
      <p className="mt-2 text-2xs leading-relaxed text-ink-subtle" data-testid="price-note">{remixPriceNote(lipsync && hostChoice)}</p>
    </MakerAside>
  )

  const summary = lookSummary({
    pauseLayout: pause ? form.pauseLayout : null, momentPip: momentTake ? form.momentPip : null,
    background: onCamera ? ((pause || momentTake || clip) && cameraValue.layout === 'greenscreen' ? 'filmed' : greenScreen ? 'greenscreen' : cameraValue.layout) : null,
    talk: silent && onCamera ? form.camera.talk : null,
    includeCaptions: form.includeCaptions, captionPreset: form.captionPreset, headlineLook: form.headlineLook.look,
    brandName: brand?.name ?? null, keyword: keyword || null, ctaClip: Boolean(form.ctaId)
  })
  const lookPanel = (
    <div data-remix-field="look" className={marked('look')}>
      <LookCard name={brand?.name ?? 'No brand'} badge={brand ? 'Brand look' : null} summary={summary} summaryTestId="look-summary"
        colors={lookColors(form.headlineLook.color, form.includeCaptions ? form.captionPreset : undefined)} open={lookOpen} onToggle={() => setLookOpen(!lookOpen)} controls="remix-look">
        <p className="text-2xs text-ink-subtle">{onCamera ? 'Optional. These start from your Brand Identity’s look and your last choices.'
          : 'Optional. Your Brand Identity decides what your presenter believes, so every take sounds like your brand and only uses your real proof. Its look fills in the style below.'}</p>
        {onCamera && <SkillsPanel rows={remixSkillRows(form)} onToggle={(id, on) => form.update(remixSkillPatch(form, id, on))}
          music={{ track: form.musicTrack || null, onChange: (track) => form.update({ musicTrack: track ?? '' }) }}
          onMore={(id) => id === 'captions' || id === 'zoom' ? () => document.getElementById('remix-style-board')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }) : undefined} />}
        {brandBlock}
        <div id="remix-style-board" className="scroll-mt-4" />
        {styleBoard(onCamera ? <>{pauseLayoutChoice}{part1Choice}{hookPlaceRow}{clipHookNote}{cameraBlock}{pipRow}{pauseCaptionsRow}{theirCaptionsRow}</> : undefined)}
      </LookCard>
    </div>
  )

  const header = (
    <PageHeader eyebrow="Studio" title="Their moment hooks. Your take is the video."
      description="React to someone else’s video. The borrowed part stays short and the creator is credited." />
  )
  const notices = (<>
    <FirstRunGuide page="remix" />
    {!openrouterConfigured && (
      <Callout tone="info" className="mt-4" title="Add your OpenRouter key to start" action={<Button size="sm" onClick={openKeys}>Open API keys</Button>}>
        Remix finds the moments, writes the takes and records the voice through your OpenRouter account.
      </Callout>
    )}
    {error && <div ref={errorRef} className="scroll-mt-4"><Callout tone="danger" className="mt-4" onDismiss={() => setError(null)}><FriendlyError error={error} /></Callout></div>}
    {lowDisk.element}
  </>)
  const runShown = status !== null && (reviewing || busy || status.phase === 'done' || status.phase === 'failed' || status.phase === 'cancelled')
  const setupMain = (<>
    {!runShown && <div>{header}{notices}</div>}
    {status && newRemixFor === status.id && (reviewing || busy) && (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-display text-lg font-semibold text-ink">New remix</p>
        <Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} onClick={() => setNewRemixFor(null)}>Hide</Button>
      </div>
    )}
    <MakerSection number={1} title={sourceTitle}>{sourcePanel}</MakerSection>
    {aiPresenter && <MakerSection number={2} title="Who’s in it">{modePanel}</MakerSection>}
    <MakerSection number={aiPresenter ? 3 : 2} title="Format" aside={`${formatCards.length} formats`}>{formatPanel}</MakerSection>
    {/* The AI presenter's own choice comes first; the look and call to action fold the same way on both sides. */}
    {!onCamera && (
      <MakerSection number={4} title="Presenter" data-remix-field="presenter" className={marked('presenter')}>
        <p className="-mt-1 mb-3 text-2xs text-ink-subtle">{silent ? 'Your avatar’s reactions play with the clip.' : 'Who delivers the take.'}</p>
        <div className="space-y-4">
          {hostCards}
          {lipsyncNote}
          {lipsyncCostNote}
          {avatarBlocks}
        </div>
      </MakerSection>
    )}
    <MakerSection number={lookStep} title="Look & call to action"><div className="space-y-2.5">{lookPanel}<StylePresets kind="remix" /></div></MakerSection>
    <MakerSection number={goStep} title="Before you start">{detailsPanel}</MakerSection>
  </>)

  return (
    <Page width="default">
      {runShown && <>{header}{notices}</>}
      {runShown && status && (
        <div className="mt-5 scroll-mt-4" ref={reviewRef}>
          {/* Moment + my take stays open while a take's hook text is written (the others keep what was typed). */}
          {(reviewing || status.phase === 'planning') && status.drafts.some((draft) => draft.format === 'moment_take')
            ? <MomentTakeReview key={status.id} status={status} onError={setError} />
            : reviewing ? (status.drafts.length === 1 && status.drafts[0].format === 'pause_react'
            ? <PauseReactReview key={status.id} status={status} onError={setError} />
            : status.drafts.length === 1 && clipFormat(status.drafts[0].format)
            ? <ClipTakeReview key={status.id} status={status} onError={setError} onOpenKeys={openKeys} />
            : <ReviewPanel key={status.id} status={status} onError={setError} />) : (
            <Panel>
              <PanelHeader title={status.phase === 'planning' ? 'Writing your takes' : status.phase === 'rendering' ? 'Making your remixes' : 'Latest run'} />
              <div className="mt-4 space-y-3">
                <RemixProgress status={status} onNavigate={onNavigate} onViewLibrary={onViewLibrary} />
                {busy && (
                  <Button variant="secondary" disabled={status.detail === 'Canceling…'} onClick={() => void getApi().remix.cancel()}>
                    {status.detail === 'Canceling…' ? 'Canceling…' : 'Cancel'}
                  </Button>
                )}
              </div>
            </Panel>
          )}
        </div>
      )}

      {setupFolded && (
        <div className="glass-tile mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3" data-testid="new-remix-fold">
          <span className="min-w-0 text-xs text-ink-muted">
            {reviewing ? 'Change this video’s look and skills in its review above. Starting a new remix replaces it.' : 'Your video is being made. You can set up the next one.'}
          </span>
          <Button size="sm" variant="secondary" icon={<Wand2 className="h-3.5 w-3.5" />} onClick={() => setNewRemixFor(status?.id ?? '')}>Start a new remix</Button>
        </div>
      )}
      {!setupFolded && <MakerLayout className={runShown ? 'mt-8' : undefined} main={setupMain} aside={goPanel} />}
    </Page>
  )
}

/** A run of one-take formats (pause and react, a screenshot): its take waits once it's recorded. */
function oneTakeRun(status: RemixStatus): boolean {
  return status.drafts.length > 0 && status.drafts.every((draft) => draft.format === 'pause_react' || draft.format === 'image' || clipFormat(draft.format))
}

/** "Pop captions · White bar · Brand: X · No call to action": the folded look section's choices in one line. */
export function lookSummary(choice: {
  pauseLayout: PauseLayout | null; momentPip: boolean | null; background: CameraSettings['layout'] | null; talk: boolean | null
  includeCaptions: boolean; captionPreset: string; headlineLook: HeadlineLookStyle; brandName: string | null; keyword: string | null; ctaClip: boolean
}): string {
  const parts: string[] = []
  if (choice.pauseLayout) parts.push(PAUSE_LAYOUTS.find((item) => item.id === choice.pauseLayout)?.label ?? '')
  if (choice.momentPip !== null) parts.push(choice.momentPip ? 'Moment small on screen while you talk' : 'You fill the screen after the moment')
  if (choice.background) parts.push(CAMERA_LAYOUTS.find((item) => item.id === choice.background)?.label ?? '')
  if (choice.talk !== null) parts.push(choice.talk ? 'You talk over it' : 'Face only')
  parts.push(choice.includeCaptions ? `${CAPTION_PRESETS.find((item) => item.id === choice.captionPreset)?.name ?? 'Your'} captions` : 'No captions')
  parts.push(HEADLINE_LOOKS.find((item) => item.id === choice.headlineLook)?.label ?? '')
  parts.push(choice.brandName ? `Brand: ${choice.brandName}` : 'No brand')
  parts.push(choice.keyword && choice.ctaClip ? `Comment ${choice.keyword} + CTA clip` : choice.keyword ? `Comment ${choice.keyword}` : choice.ctaClip ? 'CTA clip' : 'No call to action')
  return parts.filter(Boolean).join(' · ')
}

/** "About $0.04–$0.09 in all" (one figure when both ends round the same). */
export function momentCost(low: number, high: number): string {
  return low.toFixed(2) === high.toFixed(2) ? `About $${high.toFixed(2)} in all.` : `About $${low.toFixed(2)}–$${high.toFixed(2)} in all.`
}

/** How the member appears in their own recordings. */
function CameraOptions({ mode, value, onChange }: { mode: 'take' | 'silent' | 'image' | 'pause' | 'moment'; value: CameraSettings; onChange: (value: CameraSettings) => void }): React.JSX.Element {
  const silent = mode === 'silent'
  const image = mode === 'image'
  // Pause & react and your take on a moment fill the frame with you: no green screen.
  const pause = mode === 'pause' || mode === 'moment'
  const details: Partial<Record<CameraSettings['layout'], string>> = image
    ? { filmed: 'The screenshot on top, you below as filmed', cutout: 'The screenshot on top, you cut out below', greenscreen: 'The screenshot fills the screen behind you' }
    : pause ? { filmed: 'Your real room behind you', cutout: 'You cut out, over a blur or your color' }
      : {}
  // Pause & react fills the frame with you: no green screen.
  // Green screen over their video: always the green screen (filmed behind their clip is React, then my thoughts).
  const layouts = pause ? CAMERA_LAYOUTS.filter((layout) => layout.id !== 'greenscreen') : silent ? [] : CAMERA_LAYOUTS
  const chosen = pause && value.layout === 'greenscreen' ? 'filmed' : silent ? 'greenscreen' : value.layout
  return (
    <div className="glass-tile space-y-3 rounded-xl p-3">
      <div>
        <span className="flex items-center gap-1.5 text-sm text-ink"><Camera className="h-4 w-4" />Your background</span>
        <span className="block text-2xs text-ink-subtle">{silent ? 'Their moment fills the screen behind you, and you’re cut out in front of it. You record each one here, or upload a video from your phone.'
          : image || pause ? 'You record here with your camera, or upload a video from your phone.' : 'After the AI writes the takes, you record each one here with your camera, or upload a video from your phone.'}</span>
      </div>
      {layouts.length > 0 && <div className={cn('grid gap-2', pause ? 'sm:grid-cols-2' : 'sm:grid-cols-3')} role="radiogroup" aria-label="Your background">
        {layouts.map((layout) => {
          const selected = chosen === layout.id
          return (
            <button key={layout.id} type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1} onKeyDown={onRadioKeyDown}
              onClick={() => onChange({ ...value, layout: layout.id })}
              className={cn('glass-tile glass-tile-hover rounded-xl px-3 py-2.5 text-left', selected ? 'glass-selected text-ink' : 'text-ink-muted hover:text-ink')}>
              <span className="block text-xs font-medium">{layout.label}</span>
              <span className={cn('block text-2xs', selected ? 'text-ink-muted' : 'text-ink-subtle')}>{details[layout.id] ?? layout.detail}</span>
            </button>
          )
        })}
      </div>}
      {chosen === 'cutout' && (
        <div className="flex flex-wrap items-center gap-3">
          <Segmented label="Behind you" size="sm" value={value.backdrop} onChange={(backdrop) => onChange({ ...value, backdrop: backdrop as CameraSettings['backdrop'] })}
            options={[{ value: 'blur', label: image ? 'Blurred screenshot' : pause ? 'Blurred room' : 'Blurred clip' }, { value: 'brand', label: 'My color' }]} />
          {value.backdrop === 'brand' && (
            <label className="flex items-center gap-2 text-2xs text-ink-muted">
              <input type="color" aria-label="Background color" value={value.backdropColor} onChange={(e) => onChange({ ...value, backdropColor: e.target.value.toUpperCase() })}
                className="h-7 w-10 cursor-pointer rounded border border-white/10 bg-transparent" />
              {value.backdropColor}
            </label>
          )}
        </div>
      )}
      {chosen !== 'filmed' && <p className="text-2xs text-ink-subtle">Removing the background works best with even light on you and a little space between you and the wall.</p>}
      {silent && (
        <SettingRow title="Talk while reacting" description={value.talk ? 'Your voice goes over the clip, with captions of what you say. Wear headphones.' : 'Face only: just the clip’s sound, no microphone.'}
          control={<Switch label="Talk while reacting" checked={value.talk} onChange={(talk) => onChange({ ...value, talk })} />} />
      )}
    </div>
  )
}

/** Planned takes: edit, drop, then make only the approved ones. */
function ReviewPanel({ status, onError }: { status: RemixStatus; onError: (message: string | null) => void }): React.JSX.Element {
  const ordered = useMemo(() => [...status.drafts].sort((a, b) => (b.grade?.score ?? -1) - (a.grade?.score ?? -1)), [status.drafts])
  const [edits, setEdits] = useState<Record<number, RemixEdit>>({})
  const [selected, setSelected] = useState<Set<number>>(() => new Set(ordered.filter((draft) => !draft.grade || 'ABC'.includes(draft.grade.letter)).map((draft) => draft.id)))
  const [working, setWorking] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [recordings, setRecordings] = useState<RemixRecordings>({})
  const [recording, setRecording] = useState<RemixDraft | null>(null)
  const onCamera = status.onCamera === true
  // Article or post: one take over a screenshot; the AI writes its headline once you've recorded.
  const imageTake = status.drafts.length === 1 && status.drafts[0].format === 'image' ? status.drafts[0] : null
  const [screenshot, setScreenshot] = useState<string | null>(null)
  const [writeOwn, setWriteOwn] = useState(false)
  useEffect(() => {
    if (!onCamera) return
    getApi().remix.recordings().then(setRecordings).catch(() => undefined)
    if (imageTake) getApi().remix.moment(imageTake.id).then((moment) => setScreenshot(moment.path)).catch(() => undefined)
  }, [onCamera, status.id, imageTake])
  const value = (draft: RemixDraft): RemixEdit => edits[draft.id] ?? { id: draft.id, headline: draft.headline, intro: draft.intro, beats: draft.beats, close: draft.close, postCaption: draft.postCaption }
  const change = (draft: RemixDraft, patch: Partial<RemixEdit>): void => setEdits((current) => ({ ...current, [draft.id]: { ...value(draft), ...patch } }))
  const toggle = (id: number): void => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const chosen = ordered.filter((draft) => selected.has(draft.id))
  const total = chosen.reduce((sum, draft) => sum + draft.estimateUsd, 0)
  const problems = new Map(chosen.map((draft) => [draft.id, remixEditProblem(value(draft), draft.format)]))
  const missing = (draft: RemixDraft): string[] => onCamera
    ? partsFor(draft.format, value(draft).beats.length).filter((part) => !recordings[draft.id]?.[part]).map((part) => partLabel(part, draft.format))
    : []
  const unrecorded = chosen.filter((draft) => missing(draft).length > 0).length
  const blocked = [...problems.values()].some(Boolean) || unrecorded > 0

  const make = async (): Promise<void> => {
    setWorking(true); onError(null)
    try { await getApi().remix.render(chosen.map(value)) } catch (err) { onError(errorMessage(err, 'The remixes could not be started.')) }
    finally { setWorking(false) }
  }
  const write = async (): Promise<void> => {
    setWorking(true); onError(null)
    try { await getApi().remix.write() } catch (err) { onError(errorMessage(err, 'The headline could not be written.')) }
    finally { setWorking(false) }
  }
  const closeRecorder = (changed: boolean): void => {
    const draft = recording
    setRecording(null)
    // Just recorded over a screenshot with no headline yet: write it straight away (only for a new recording, so it isn't paid for twice).
    if (changed && draft?.format === 'image' && !draft.headline && !edits[draft.id]?.headline && recordings[draft.id]?.reaction) void write()
  }
  const discard = async (): Promise<void> => {
    if (!confirmDiscard) { setConfirmDiscard(true); return }
    setWorking(true); onError(null)
    try { await getApi().remix.discard() } catch (err) { onError(errorMessage(err)) } finally { setWorking(false) }
  }

  return (
    <Panel>
      <PanelHeader title={imageTake ? 'Your take on the screenshot' : `Review your takes · ${status.drafts.length}`}
        description={imageTake
          ? 'Record yourself talking about it. The AI then writes the hook text and caption from what you said, and you can edit both before the video is made.'
          : `Graded on the Paid Creators frameworks, best first. Edit any line, untick the ones you don't want, then make the rest.${status.costUsd !== null ? ` Planning cost about $${status.costUsd.toFixed(2)}.` : ''}`} />
      <div className="mt-4 space-y-3">
        {status.error && <Callout tone="danger"><FriendlyError error={status.error} suffix={imageTake ? 'Your recording is still here, so you can try again.' : 'Your takes are still here, so you can try again.'} /></Callout>}
        {status.warnings.map((warning, i) => <Callout key={i} tone="warning">{warning}</Callout>)}
        {ordered.map((draft, position) => {
          const current = value(draft)
          const on = selected.has(draft.id)
          const take = `take ${position + 1}`
          const image = draft.format === 'image'
          // Over a screenshot the headline comes after the recording: no need to flag it before then.
          const showText = !image || Boolean(draft.headline) || writeOwn || Boolean(edits[draft.id])
          const problem = on && showText ? problems.get(draft.id) : null
          const counter = (text: string, limit: number): string => `${wordCount(text)} / ${limit} words`
          const cta = /\b[Cc]omment\s+["“]?([A-Z0-9][A-Z0-9-]{1,19})\b/.exec(draft.close)?.[1]
          return (
            <div key={draft.id} className={cn('glass-tile space-y-3 rounded-2xl p-4', !on && 'opacity-60')}>
              {!image && <div className="flex items-start gap-3">
                <Checkbox checked={on} onChange={() => toggle(draft.id)} label={`Make “${current.headline}”`} className="mt-1" />
                {draft.grade && (
                  <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-base font-black', GRADE_TONES[draft.grade.letter])}
                    title={`Grade ${draft.grade.letter} (${draft.grade.score.toFixed(1)}/10)${draft.grade.edited ? ' · graded before your edits' : ''}`}>{draft.grade.letter}</span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap gap-1.5">
                    {!onCamera && !headlineOnly(draft.format) && <Badge>{STYLE_LABELS[draft.style]}</Badge>}
                    {!onCamera && !headlineOnly(draft.format) && <Badge>{STANCE_LABELS[draft.stance]}</Badge>}
                    {draft.creator && <Badge>{draft.creator}</Badge>}
                    {!onCamera && <Badge>about ${draft.estimateUsd.toFixed(2)}</Badge>}
                  </div>
                  {draft.grade?.verdict && <p className="mt-1.5 text-xs text-ink-muted">{draft.grade.verdict}</p>}
                  {draft.grade?.fix && <p className="mt-0.5 text-xs text-ink-subtle"><Sparkles className="mr-1 inline h-3 w-3" />{draft.grade.fix}</p>}
                </div>
              </div>}
              {image ? (
                <div className="flex gap-3 rounded-xl bg-white/[0.04] p-2 text-xs text-ink-muted">
                  {screenshot && <img src={localFileUrl(screenshot)} alt="Your screenshot" className="h-28 w-24 shrink-0 rounded-lg object-cover object-top" />}
                  <div className="min-w-0 py-1">
                    <span className="font-medium text-ink">Source: {draft.creator}</span>
                    {draft.quote ? <p className="mt-1 line-clamp-4 italic">You said: “{draft.quote}”</p> : <p className="mt-1">Say what it says and what you think about it.</p>}
                  </div>
                </div>
              ) : <div className="rounded-xl bg-white/[0.04] px-3 py-2 text-xs text-ink-muted">
                <span className="font-medium text-ink">Their moment</span> · {((draft.endMs - draft.startMs) / 1000).toFixed(1)}s{draft.sourceTitle ? ` from “${draft.sourceTitle}”` : ''}
                <p className={cn('mt-0.5 italic', draft.format === 'silent' && 'line-clamp-4')}>“{draft.quote}”</p>
              </div>}
              {onCamera && on && (() => {
                const left = missing(draft)
                const total = partsFor(draft.format, current.beats.length).length
                return (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 px-3 py-2">
                    <Camera className="h-4 w-4 text-ink-muted" />
                    <span className="flex-1 text-xs text-ink-muted">
                      {left.length === 0 ? <span className="text-success"><Check className="mr-1 inline h-3 w-3" />Recorded</span>
                        : image ? 'Record yourself talking about this screenshot.'
                        : draft.format === 'silent' ? 'Film your reaction to this moment.'
                          : `Record your lines: ${total - left.length} of ${total} done.`}
                      {!headlineOnly(draft.format) && left.length === 0 && <span className="text-ink-subtle"> · Change a line? Record that part again.</span>}
                    </span>
                    <Button size="sm" variant={left.length ? 'primary' : 'secondary'} icon={<Camera className="h-3.5 w-3.5" />} disabled={working}
                      onClick={() => setRecording(draft)}>{left.length === 0 ? 'Review or redo' : left.length < total ? 'Keep recording' : 'Record'}</Button>
                    {image && left.length === 0 && (
                      <Button size="sm" variant={draft.headline ? 'ghost' : 'primary'} icon={<Sparkles className="h-3.5 w-3.5" />} disabled={working} loading={working}
                        onClick={() => void write()}>{draft.headline ? 'Rewrite from what I said' : 'Write my headline and caption'}</Button>
                    )}
                  </div>
                )
              })()}
              {image && !showText && (
                <button type="button" className="text-2xs text-tool" onClick={() => setWriteOwn(true)}>Or write the headline and caption yourself</button>
              )}
              {!onCamera && draft.format === 'silent' && draft.cues.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5" aria-label={`Reactions, ${take}`}>
                  <span className="text-2xs text-ink-subtle">Reactions:</span>
                  {draft.cues.map((cue, i) => <Badge key={i}>{cue.at.toFixed(0)}s · {REACTIONS.find((item) => item.id === cue.reaction)?.label ?? cue.reaction}</Badge>)}
                </div>
              )}
              {showText && <Field label="Headline" hint={`${counter(current.headline, REMIX_WORD_LIMITS.headline)} · the hook text at the top (unless you chose no hook text) and the video’s title in your Library`}>
                <TextInput aria-label={`Headline, ${take}`} value={current.headline} maxLength={160} onChange={(e) => change(draft, { headline: e.target.value })} />
              </Field>}
              {!headlineOnly(draft.format) && (<>
              <Field label="Opening (presenter)" hint={counter(current.intro, REMIX_WORD_LIMITS.intro)}>
                <TextArea aria-label={`Opening (presenter), ${take}`} rows={2} value={current.intro} onChange={(e) => change(draft, { intro: e.target.value })} />
              </Field>
              {current.beats.map((beat, index) => (
                <Field key={index} label={`Beat ${index + 1} (voice-over on “${beat.broll}”)`} hint={counter(beat.text, REMIX_WORD_LIMITS.beat)}>
                  <TextArea aria-label={`Beat ${index + 1}, ${take}`} rows={2} value={beat.text} onChange={(e) => change(draft, { beats: current.beats.map((b, i) => i === index ? { ...b, text: e.target.value } : b) })} />
                </Field>
              ))}
              <Field label="Close (presenter)" hint={`${counter(closeWithoutCta(current.close), REMIX_WORD_LIMITS.close)}${cta ? ` · plus “Comment ${cta}…”, which is added back if you remove it` : ''}`}>
                <TextArea aria-label={`Close (presenter), ${take}`} rows={2} value={current.close} onChange={(e) => change(draft, { close: e.target.value })} />
              </Field>
              </>)}
              {showText && <Field label="Post caption" hint={`${(current.postCaption ?? '').length.toLocaleString('en-US')} / ${MAX_POST_CAPTION_CHARS.toLocaleString('en-US')} characters · filled in when you post from the Library; empty keeps the AI’s`}>
                <TextArea aria-label={`Post caption, ${take}`} rows={6} value={current.postCaption ?? ''} maxLength={MAX_POST_CAPTION_CHARS}
                  onChange={(e) => change(draft, { postCaption: e.target.value })} />
              </Field>}
              {edits[draft.id] && draft.grade && <p className="text-2xs text-ink-subtle">Graded before your edits.</p>}
              {problem && <p className="text-2xs text-danger" role="alert">{problem}</p>}
              {draft.notes.map((note, i) => <p key={i} className="text-2xs text-warning"><AlertTriangle className="mr-1 inline h-3 w-3" />{note}</p>)}
            </div>
          )
        })}
        {onCamera && <RemixLookSection status={status} disabled={working} frame={recordings[ordered[0]?.id ?? 0]?.reaction?.path ?? null}
          hookText={ordered[0] ? value(ordered[0]).headline : ''} onError={onError} />}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" icon={<Wand2 className="h-4 w-4" />} loading={working} disabled={working || chosen.length === 0 || blocked}
            tooltip={unrecorded > 0 ? `Record yourself for ${unrecorded === 1 ? 'the take' : `${unrecorded} takes`} still marked “Record”`
              : imageTake && !value(imageTake).headline.trim() ? 'Write the headline first' : blocked ? 'Fix the takes marked in red first' : undefined} onClick={() => void make()}>
            Make {chosen.length === 1 ? '1 remix' : `${chosen.length} remixes`}{chosen.length ? ` · about $${total.toFixed(2)}` : ''}
          </Button>
          <Button variant={confirmDiscard ? 'danger' : 'ghost'} icon={<X className="h-4 w-4" />} disabled={working} onClick={() => void discard()}>
            {confirmDiscard ? 'Click again to discard' : imageTake ? 'Discard' : 'Discard all'}
          </Button>
        </div>
      </div>
      {recording && <RemixRecorder draft={recording} edit={value(recording)} recordings={recordings} talk={status.cameraTalk === true} cameraLayout={status.cameraLayout}
        onRecordings={setRecordings} onClose={closeRecorder} />}
    </Panel>
  )
}

function RemixProgress({ status, onNavigate, onViewLibrary }: { status: RemixStatus; onNavigate: (page: PageName) => void; onViewLibrary?: (outputDir: string) => void }): React.JSX.Element | null {
  if (status.phase === 'failed') return <Callout tone="danger"><FriendlyError error={status.error ?? 'The remix failed.'} /></Callout>
  if (status.phase === 'cancelled') {
    if (status.detail === 'Discarded') return <Callout tone="info">Takes discarded. Nothing was made.</Callout>
    if (status.detail === 'Canceled while planning') return <Callout tone="info">Canceled before anything was made.</Callout>
    return (
      <Callout tone="info" action={<Button size="sm" variant="secondary" onClick={() => void getApi().shell.openPath(status.folder)}>Open folder</Button>}>
        Remix canceled. Any remixes already finished are in the folder and your Library. Steps already running on OpenRouter may still be charged.
      </Callout>
    )
  }
  if (isRunning(status)) {
    return (
      <div className="space-y-1.5">
        <div className="flex justify-between gap-3 text-xs text-ink-muted"><span className="truncate">{status.detail}</span><span>{status.percent}%</span></div>
        <ProgressBar value={status.percent} />
      </div>
    )
  }
  if (status.phase !== 'done') return null
  // On camera and headline-only videos have no written take: no style or stance to show.
  const plain = status.onCamera === true || status.drafts.some((draft) => headlineOnly(draft.format))
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink">
          {status.outputs.length} remix{status.outputs.length === 1 ? '' : 'es'} ready · also in your Library for posting
          {status.costUsd !== null && <span className="text-ink-subtle"> · about ${status.costUsd.toFixed(2)} total</span>}
        </p>
        <Button size="sm" variant="secondary" icon={<FolderOpen className="h-3.5 w-3.5" />} onClick={() => void getApi().shell.openPath(status.folder)}>Open folder</Button>
      </div>
      {status.warnings.map((warning, i) => <Callout key={i} tone="warning">{warning}</Callout>)}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {status.outputs.map((output) => <RemixCard key={output.path} output={output} plain={plain} folder={status.folder} onNavigate={onNavigate} onViewLibrary={onViewLibrary} />)}
      </div>
    </div>
  )
}

/** The video's Library clip, read from the run's job_output.json (posting starts from it, like the Library). */
async function libraryClip(folder: string, path: string): Promise<PostableClip | null> {
  const output = parseJobOutput(await getApi().history.getJob(folder))
  const clip = output?.clips.find((item) => clipFilePath(item.s3_url) === path)
  return clip ? { ...toPostable(clip), library: { outputDir: folder, clipIndex: clip.clip_index } } : null
}

function RemixCard({ output, plain, folder, onNavigate, onViewLibrary }: { output: RemixOutput; plain: boolean; folder: string; onNavigate: (page: PageName) => void; onViewLibrary?: (outputDir: string) => void }): React.JSX.Element {
  const issues = output.checks.filter((check) => !check.ok).length
  const [copied, setCopied] = useState(false)
  const [posting, setPosting] = useState<PostableClip | null>(null)
  const [opening, setOpening] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const post = async (): Promise<void> => {
    setOpening(true); setProblem(null)
    try {
      const clip = await libraryClip(folder, output.path)
      if (clip) setPosting(clip)
      else setProblem('This video isn’t in your Library yet. Open it from the Library to post it.')
    } catch (err) { setProblem(errorMessage(err, 'This video could not be opened for posting.')) }
    finally { setOpening(false) }
  }
  return (
    <div className="glass-tile space-y-2 rounded-2xl p-3">
      <video src={localFileUrl(output.path)} controls preload="metadata" className="mx-auto aspect-[9/16] max-h-[380px] rounded-xl bg-black" />
      <p className="line-clamp-2 text-sm font-medium text-ink" title={output.headline}>{output.headline}</p>
      <div className="flex flex-wrap gap-1.5">
        {output.grade && <Badge>Grade {output.grade}</Badge>}
        {!plain && <Badge>{STYLE_LABELS[output.style]}</Badge>}
        {!plain && <Badge>{STANCE_LABELS[output.stance]}</Badge>}
        <Badge tone={issues ? 'warning' : 'success'}>{issues ? `${issues} to review` : 'Checks passed'}</Badge>
        <Badge>{output.durationSeconds.toFixed(0)}s · ${output.costUsd.toFixed(2)}</Badge>
      </div>
      <ul className="space-y-1">
        {output.checks.map((check) => (
          <li key={check.id} className={cn('flex gap-1.5 text-2xs', check.ok ? 'text-ink-muted' : 'text-warning')}>
            {check.ok ? <Check className="mt-px h-3 w-3 shrink-0 text-success" /> : <AlertTriangle className="mt-px h-3 w-3 shrink-0" />}
            <span>{check.label}</span>
          </li>
        ))}
      </ul>
      {output.warnings.map((warning, i) => <p key={i} className="text-2xs text-warning">{warning}</p>)}
      {output.postCaption && (
        <details className="rounded-xl bg-white/[0.04] px-3 py-2 text-xs text-ink-muted">
          <summary className="cursor-pointer text-ink">Post caption</summary>
          <p className="mt-1.5 whitespace-pre-line" data-selectable>{output.postCaption}</p>
        </details>
      )}
      <div className="flex flex-wrap gap-2">
        {output.postCaption && (
          <Button size="sm" variant="secondary" icon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            onClick={() => { void navigator.clipboard?.writeText(output.postCaption).then(() => setCopied(true)).catch(() => undefined) }}>
            {copied ? 'Copied' : 'Copy caption'}
          </Button>
        )}
        <Button size="sm" variant="primary" icon={<Send className="h-3.5 w-3.5" />} loading={opening} disabled={opening} onClick={() => void post()}>Post or schedule</Button>
        {onViewLibrary && <Button size="sm" variant="secondary" icon={<Library className="h-3.5 w-3.5" />} onClick={() => onViewLibrary(folder)}>Open in Library</Button>}
        <Button size="sm" variant="secondary" icon={<FolderOpen className="h-3.5 w-3.5" />} onClick={() => void getApi().shell.showItemInFolder(output.path)}>Show in folder</Button>
        <Button size="sm" variant="ghost" icon={<FileText className="h-3.5 w-3.5" />} onClick={() => void getApi().shell.openPath(output.manifestPath)}>Source record</Button>
      </div>
      {problem && <p role="alert" className="text-2xs text-warning">{problem}</p>}
      {posting && <PostDialog clips={[posting]} onClose={() => setPosting(null)} onNavigate={onNavigate} />}
    </div>
  )
}
