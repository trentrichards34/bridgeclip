/**
 * My B-roll library: the member's own clips and pictures (and AI shots made for them), kept on this computer.
 *
 * Originals stay where they are; the app keeps a small 720p proxy and a poster frame for each, and an index of
 * what a vision model saw in every shot (index.json in userData/broll-library, written by src/main/broll-library.ts).
 * Long clips are split into shots with in/out times. Create, Remix and the B-roll planner in the engine
 * (engine/clip_engine/services/broll_library.py) read a compact catalog of those shots and pick the ones that match
 * what is said.
 *
 * Everything here is plain data and checks, shared by main, the renderer and the tests.
 */

import { PRICES } from './avatars'

export const BROLL_LIBRARY_VERSION = 1
export const BROLL_LIBRARY_VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm', 'mkv'] as const
export const BROLL_LIBRARY_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'] as const
/** The library holds at most this many items, each split into at most this many shots. */
export const MAX_LIBRARY_ITEMS = 2000
export const MAX_SHOTS_PER_ITEM = 40
/** Adding a folder looks this deep and takes at most this many files at once. */
export const MAX_FOLDER_DEPTH = 4
export const MAX_ADD_FILES = 500
/** A clip longer than this is split into shots at scene changes. */
export const SPLIT_LONGER_THAN_S = 12
/** Shots are 1.5 to 10 seconds; a long scene is cut into ~6 s pieces. */
export const MIN_SHOT_S = 1.5
export const MAX_SHOT_S = 10
export const SPLIT_PIECE_S = 6
export const MAX_NAME_CHARS = 80
export const MAX_TAG_CHARS = 30
export const MAX_TAGS = 20
/** What the vision model may write. */
export const MAX_DESCRIPTION_CHARS = 300
export const MAX_TEXT_CHARS = 120
/** Frames looked at per shot, and the estimate used for the spending check (a small vision call). */
export const FRAMES_PER_SHOT = 3
export const INDEX_ESTIMATE_PER_SHOT_USD = 0.002

export const SHOT_TYPES = ['wide', 'medium', 'close', 'top-down', 'screen', 'product', 'hands', 'talking', 'text', 'other'] as const
export type ShotType = (typeof SHOT_TYPES)[number]
export const SHOT_MOTIONS = ['still', 'slow', 'fast'] as const
export type ShotMotion = (typeof SHOT_MOTIONS)[number]

export type BrollMediaKind = 'video' | 'image'
export type BrollItemStatus = 'new' | 'ready' | 'failed'

/** What the vision model saw in one shot. */
export interface BrollAnalysis {
  description: string
  tags: string[]
  subjects: string[]
  setting: string
  shotType: ShotType
  motion: ShotMotion
  mood: string
  /** The member (the person marked "this is me") seems to be in it. */
  memberAppears: boolean
  /** Words readable on screen ('' for none). */
  onScreenText: string
  /** Notes like "blurry", "dark", "shaky" ('' when fine). */
  quality: string
  model: string
  analyzedAt: string
}

/** One usable shot of an item: the whole picture, or a stretch of a video (seconds in the original). */
export interface BrollShotRange {
  id: string
  inS: number
  outS: number
  analysis: BrollAnalysis | null
}

export interface BrollLibraryItem {
  id: string
  kind: BrollMediaKind
  /** The name the member sees (renamable). */
  name: string
  /** The original file, used in place. */
  original: string
  /** File names inside the library's proxies/ and posters/ folders (null until made). */
  proxy: string | null
  poster: string | null
  durationS: number
  width: number
  height: number
  /** The original's size and change time when it was last processed: a change means it is looked at again. */
  size: number
  mtimeMs: number
  addedAt: string
  origin: 'member' | 'ai'
  /** AI shots: what was asked for, and the model. */
  aiPrompt?: string
  aiModel?: string
  /** The member's own tags. */
  tags: string[]
  /** "This is me": the member is in it. */
  me: boolean
  shots: BrollShotRange[]
  status: BrollItemStatus
  error?: string
}

export interface BrollLibraryIndex {
  version: typeof BROLL_LIBRARY_VERSION
  items: BrollLibraryItem[]
}

/** One item as the B-roll library page shows it (paths are authorized for preview). */
export interface BrollLibraryEntry extends BrollLibraryItem {
  /** The original is gone: the proxy stands in for it. */
  missing: boolean
  proxyPath: string | null
  posterPath: string | null
  /** The original, when it is still there. */
  originalPath: string | null
}

export interface BrollLibraryView {
  items: BrollLibraryEntry[]
  /** Shots not looked at yet (what "Look at new clips" would cost). */
  pendingShots: number
  /** Looked-at shots whose file is there: what Create and Remix can use. */
  usableShots: number
  /** Items still being prepared (proxy and poster). */
  preparing: number
  indexing: BrollIndexProgress | null
  ai: BrollAiSettings
}

export interface BrollIndexProgress {
  phase: 'preparing' | 'looking' | 'done' | 'failed' | 'cancelled'
  done: number
  total: number
  /** What the looks cost so far, as OpenRouter reported. */
  costUsd: number
  message?: string
}

// ---------------------------------------------------------------------------
// Ids and small checks
// ---------------------------------------------------------------------------

const ITEM_ID = /^l[0-9a-f]{12}$/
const SHOT_ID = /^s[0-9]{1,3}$/
export const isLibraryItemId = (value: unknown): value is string => typeof value === 'string' && ITEM_ID.test(value)
export const isLibraryShotRef = (value: unknown): value is string => typeof value === 'string' && /^l[0-9a-f]{12}:s[0-9]{1,3}$/.test(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const SAFE_FILE = /^[A-Za-z0-9_-]{1,80}\.(mp4|jpg)$/

export function libraryMediaKind(name: string): BrollMediaKind | null {
  const extension = name.split('.').pop()?.toLowerCase() ?? ''
  if ((BROLL_LIBRARY_VIDEO_EXTENSIONS as readonly string[]).includes(extension)) return 'video'
  if ((BROLL_LIBRARY_IMAGE_EXTENSIONS as readonly string[]).includes(extension)) return 'image'
  return null
}

/** One line of plain text, at most `max` characters. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

/** A tag: lower-case words, letters, numbers, spaces and dashes. */
export function cleanTag(value: unknown): string {
  return cleanText(value, MAX_TAG_CHARS * 2).toLowerCase().replace(/[^\p{L}\p{N} &'-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_CHARS)
}

export function cleanTags(value: unknown, max = MAX_TAGS): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const raw of value) {
    const tag = cleanTag(raw)
    if (tag && !out.includes(tag)) out.push(tag)
    if (out.length >= max) break
  }
  return out
}

/** Tags typed by the member, separated by commas. */
export function parseTagInput(text: string): string[] {
  return cleanTags(text.split(','))
}

// ---------------------------------------------------------------------------
// The vision model's answer
// ---------------------------------------------------------------------------

export const ANALYSIS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['description', 'tags', 'subjects', 'setting', 'shot_type', 'motion', 'mood', 'member_appears', 'on_screen_text', 'quality'],
  properties: {
    description: { type: 'string', description: 'One plain sentence: what is shown, as someone choosing b-roll would describe it.' },
    tags: { type: 'array', items: { type: 'string' }, description: '3-10 short search words: objects, actions, places.' },
    subjects: { type: 'array', items: { type: 'string' }, description: 'The main things or people shown (no names).' },
    setting: { type: 'string', description: 'Where it is, like "home office", "kitchen", "street at night".' },
    shot_type: { type: 'string', enum: [...SHOT_TYPES] },
    motion: { type: 'string', enum: [...SHOT_MOTIONS] },
    mood: { type: 'string', description: 'One or two words, like "calm", "busy", "warm".' },
    member_appears: { type: 'boolean', description: 'True when the person in the reference photo appears.' },
    on_screen_text: { type: 'string', description: 'Readable words on screen, or empty.' },
    quality: { type: 'string', description: 'Problems like blurry, dark, shaky; empty when fine.' }
  }
} as const

/** The model's JSON, checked and trimmed. Throws when it isn't usable. */
export function parseAnalysis(raw: unknown, model: string, at = new Date().toISOString()): BrollAnalysis {
  let value = raw
  if (typeof value === 'string') {
    const text = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    try { value = JSON.parse(text) } catch { throw new Error('The answer was not JSON') }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The answer was not an object')
  const v = value as Record<string, unknown>
  const description = cleanText(v.description, MAX_DESCRIPTION_CHARS)
  if (!description) throw new Error('The answer had no description')
  const shotType = (SHOT_TYPES as readonly string[]).includes(String(v.shot_type ?? v.shotType)) ? String(v.shot_type ?? v.shotType) as ShotType : 'other'
  const motion = (SHOT_MOTIONS as readonly string[]).includes(String(v.motion)) ? v.motion as ShotMotion : 'slow'
  return {
    description,
    tags: cleanTags(v.tags, 12),
    subjects: cleanTags(v.subjects, 8),
    setting: cleanText(v.setting, MAX_TEXT_CHARS),
    shotType,
    motion,
    mood: cleanText(v.mood, 40),
    memberAppears: (v.member_appears ?? v.memberAppears) === true,
    onScreenText: cleanText(v.on_screen_text ?? v.onScreenText, MAX_TEXT_CHARS),
    quality: cleanText(v.quality, MAX_TEXT_CHARS),
    model: cleanText(model, 120),
    analyzedAt: at
  }
}

/** A saved analysis (index.json), or null when it's damaged. */
function storedAnalysis(value: unknown): BrollAnalysis | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  try {
    const parsed = parseAnalysis({
      description: v.description, tags: v.tags, subjects: v.subjects, setting: v.setting, shot_type: v.shotType, motion: v.motion,
      mood: v.mood, member_appears: v.memberAppears, on_screen_text: v.onScreenText, quality: v.quality
    }, typeof v.model === 'string' ? v.model : '', typeof v.analyzedAt === 'string' && !Number.isNaN(Date.parse(v.analyzedAt)) ? v.analyzedAt : new Date(0).toISOString())
    return parsed
  } catch { return null }
}

// ---------------------------------------------------------------------------
// index.json
// ---------------------------------------------------------------------------

function parseShot(value: unknown, kind: BrollMediaKind, durationS: number): BrollShotRange | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (typeof v.id !== 'string' || !SHOT_ID.test(v.id) || !finite(v.inS) || !finite(v.outS)) return null
  if (kind === 'image') return { id: v.id, inS: 0, outS: 0, analysis: storedAnalysis(v.analysis) }
  if (v.inS < 0 || v.outS <= v.inS || (durationS > 0 && v.inS >= durationS)) return null
  return { id: v.id, inS: Math.round(v.inS * 1000) / 1000, outS: Math.round(Math.min(v.outS, durationS || v.outS) * 1000) / 1000, analysis: storedAnalysis(v.analysis) }
}

/** One saved item, checked; null drops it. */
export function parseLibraryItem(value: unknown): BrollLibraryItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (!isLibraryItemId(v.id) || (v.kind !== 'video' && v.kind !== 'image')) return null
  if (typeof v.original !== 'string' || !v.original || v.original.length > 4096 || v.original.includes('\0')) return null
  const kind = v.kind as BrollMediaKind
  const durationS = kind === 'video' && finite(v.durationS) && v.durationS > 0 && v.durationS < 24 * 3600 ? v.durationS : 0
  const shots = Array.isArray(v.shots) ? v.shots.slice(0, MAX_SHOTS_PER_ITEM).map((shot) => parseShot(shot, kind, durationS)).filter((shot): shot is BrollShotRange => shot !== null) : []
  const ids = new Set<string>()
  const unique = shots.filter((shot) => !ids.has(shot.id) && ids.add(shot.id))
  const status: BrollItemStatus = v.status === 'ready' || v.status === 'failed' ? v.status : 'new'
  const item: BrollLibraryItem = {
    id: v.id, kind, name: cleanText(v.name, MAX_NAME_CHARS) || 'Untitled', original: v.original,
    proxy: typeof v.proxy === 'string' && SAFE_FILE.test(v.proxy) ? v.proxy : null,
    poster: typeof v.poster === 'string' && SAFE_FILE.test(v.poster) ? v.poster : null,
    durationS, width: finite(v.width) && v.width > 0 ? Math.round(v.width) : 0, height: finite(v.height) && v.height > 0 ? Math.round(v.height) : 0,
    size: finite(v.size) && v.size >= 0 ? v.size : 0, mtimeMs: finite(v.mtimeMs) && v.mtimeMs >= 0 ? v.mtimeMs : 0,
    addedAt: typeof v.addedAt === 'string' && !Number.isNaN(Date.parse(v.addedAt)) ? v.addedAt : new Date(0).toISOString(),
    origin: v.origin === 'ai' ? 'ai' : 'member',
    tags: cleanTags(v.tags), me: v.me === true,
    // A "ready" item has its shots; one without any goes back to be prepared.
    shots: unique, status: status === 'ready' && !unique.length ? 'new' : status
  }
  if (item.origin === 'ai') {
    const prompt = cleanText(v.aiPrompt, 600)
    const model = cleanText(v.aiModel, 120)
    if (prompt) item.aiPrompt = prompt
    if (model) item.aiModel = model
  }
  if (item.status === 'failed') item.error = cleanText(v.error, 200) || 'This file could not be read.'
  return item
}

/** index.json as read from disk: a newer or damaged file gives an empty library (the caller keeps the file aside). */
export function parseLibraryIndex(value: unknown): BrollLibraryIndex {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { version: BROLL_LIBRARY_VERSION, items: [] }
  const v = value as Record<string, unknown>
  if (v.version !== BROLL_LIBRARY_VERSION || !Array.isArray(v.items)) return { version: BROLL_LIBRARY_VERSION, items: [] }
  const seen = new Set<string>()
  const items: BrollLibraryItem[] = []
  for (const raw of v.items.slice(0, MAX_LIBRARY_ITEMS)) {
    const item = parseLibraryItem(raw)
    if (item && !seen.has(item.id)) { seen.add(item.id); items.push(item) }
  }
  return { version: BROLL_LIBRARY_VERSION, items }
}

/** Shots not looked at yet, in items that are ready. */
export function pendingShots(items: readonly BrollLibraryItem[]): { item: BrollLibraryItem; shot: BrollShotRange }[] {
  return items.flatMap((item) => item.status === 'ready' ? item.shots.filter((shot) => !shot.analysis).map((shot) => ({ item, shot })) : [])
}

// ---------------------------------------------------------------------------
// Splitting a long clip into shots
// ---------------------------------------------------------------------------

/**
 * Shots of a video from its scene changes (seconds): scenes shorter than MIN_SHOT_S join the one before,
 * longer than MAX_SHOT_S are cut into ~SPLIT_PIECE_S pieces. A short clip is one shot.
 */
export function shotsFromScenes(durationS: number, changes: readonly number[]): { inS: number; outS: number }[] {
  if (!finite(durationS) || durationS <= 0) return []
  if (durationS <= SPLIT_LONGER_THAN_S) return [{ inS: 0, outS: round3(durationS) }]
  const cuts = [...new Set(changes.filter((t) => finite(t) && t > 0 && t < durationS).map(round3))].sort((a, b) => a - b)
  const bounds = [0, ...cuts, durationS]
  const scenes: { inS: number; outS: number }[] = []
  for (let i = 0; i < bounds.length - 1; i++) {
    const inS = bounds[i], outS = bounds[i + 1]
    if (scenes.length && outS - inS < MIN_SHOT_S) { scenes[scenes.length - 1].outS = outS; continue }
    scenes.push({ inS, outS })
  }
  if (scenes.length > 1 && scenes[0].outS - scenes[0].inS < MIN_SHOT_S) { scenes[1].inS = 0; scenes.shift() }
  const shots: { inS: number; outS: number }[] = []
  for (const scene of scenes) {
    const length = scene.outS - scene.inS
    const pieces = length > MAX_SHOT_S ? Math.ceil(length / SPLIT_PIECE_S) : 1
    for (let k = 0; k < pieces; k++) {
      shots.push({ inS: round3(scene.inS + (length * k) / pieces), outS: round3(k === pieces - 1 ? scene.outS : scene.inS + (length * (k + 1)) / pieces) })
    }
  }
  return shots.slice(0, MAX_SHOTS_PER_ITEM)
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000

// ---------------------------------------------------------------------------
// Search (local, over the index)
// ---------------------------------------------------------------------------

function itemText(item: BrollLibraryItem): string {
  const parts = [item.name, ...item.tags, item.me ? 'me' : '', item.origin === 'ai' ? 'ai' : '', item.aiPrompt ?? '']
  for (const shot of item.shots) {
    const a = shot.analysis
    if (a) parts.push(a.description, ...a.tags, ...a.subjects, a.setting, a.shotType, a.mood, a.onScreenText, a.memberAppears ? 'me' : '')
  }
  return parts.join(' ').toLowerCase()
}

/** Items whose name, tags or what was seen in them contain every word of the search. */
export function searchLibrary<T extends BrollLibraryItem>(items: readonly T[], query: string): T[] {
  const terms = query.toLowerCase().split(/\s+/).map((term) => term.replace(/[^\p{L}\p{N}-]/gu, '')).filter(Boolean)
  if (!terms.length) return [...items]
  return items.filter((item) => {
    const text = itemText(item)
    return terms.every((term) => text.includes(term))
  })
}

// ---------------------------------------------------------------------------
// The catalog the engine reads
// ---------------------------------------------------------------------------

export const BROLL_CATALOG_VERSION = 1

/** One shot the planner can choose: its file, the usable stretch and what's in it. */
export interface BrollCatalogShot {
  /** "<item id>:<shot id>". */
  id: string
  path: string
  kind: BrollMediaKind
  inS: number
  outS: number
  description: string
  tags: string[]
  shotType: ShotType
  me: boolean
  ai: boolean
  /** Words are written on it (a headline, a screen): kept from under hook text when possible. Absent: none seen. */
  text?: boolean
}

export interface BrollCatalog {
  version: typeof BROLL_CATALOG_VERSION
  shots: BrollCatalogShot[]
}

/** Catalog limits: the planner sees at most this many shots. */
export const MAX_CATALOG_SHOTS = 600

/**
 * The shots the engine may use: analyzed shots of ready items whose file is there (`usablePath` returns the original,
 * or the proxy when the original is gone, or null). Shots flagged as blurry or dark go last.
 */
export function buildCatalog(items: readonly BrollLibraryItem[], usablePath: (item: BrollLibraryItem) => string | null): BrollCatalog {
  const good: BrollCatalogShot[] = [], poor: BrollCatalogShot[] = []
  for (const item of items) {
    if (item.status !== 'ready') continue
    const path = usablePath(item)
    if (!path) continue
    for (const shot of item.shots) {
      const a = shot.analysis
      if (!a) continue
      const entry: BrollCatalogShot = {
        id: `${item.id}:${shot.id}`, path, kind: item.kind, inS: shot.inS, outS: shot.outS,
        description: a.description, tags: [...new Set([...item.tags, ...a.tags])].slice(0, 12), shotType: a.shotType,
        me: item.me || a.memberAppears, ai: item.origin === 'ai', ...(a.onScreenText ? { text: true } : {})
      }
      ;(/blur|dark|shak|out of focus|low light/i.test(a.quality) ? poor : good).push(entry)
    }
  }
  return { version: BROLL_CATALOG_VERSION, shots: [...good, ...poor].slice(0, MAX_CATALOG_SHOTS) }
}

/** One compact line per shot for a planner prompt: id, length, kind, who, what. */
export function catalogLine(shot: BrollCatalogShot): string {
  const seconds = shot.kind === 'image' ? 'still' : `${Math.max(0, shot.outS - shot.inS).toFixed(1)}s`
  return `${shot.id} | ${seconds} | ${shot.shotType}${shot.me ? ' | me' : ''}${shot.ai ? ' | ai' : ''} | ${shot.description} [${shot.tags.join(', ')}]`
}

// ---------------------------------------------------------------------------
// Where b-roll comes from (Create, Remix)
// ---------------------------------------------------------------------------

export const BROLL_SOURCES = ['library', 'stock', 'ai', 'library_ai'] as const
export type BrollSource = (typeof BROLL_SOURCES)[number]
export const isBrollSource = (value: unknown): value is BrollSource => typeof value === 'string' && (BROLL_SOURCES as readonly string[]).includes(value)

export const BROLL_SOURCE_LABELS: Record<BrollSource, string> = {
  library: 'My library',
  stock: 'Stock (Pexels)',
  ai: 'AI-generated',
  library_ai: 'My library, then AI for gaps'
}

export const BROLL_SOURCE_DETAILS: Record<BrollSource, string> = {
  library: 'Shots from your B-roll library that match what you say.',
  stock: 'Stock footage from Pexels that matches what you say.',
  ai: 'New shots made with AI on OpenRouter for the moments that need one.',
  library_ai: 'Your library first; AI makes a shot only where nothing in it fits.'
}

export interface BrollSourceContext {
  /** Shots in the library the planner can use. */
  libraryShots: number
  pexels: boolean
  openrouter: boolean
}

/** Why a source can't be chosen right now, or null. */
export function brollSourceProblem(source: BrollSource, context: BrollSourceContext): string | null {
  if ((source === 'library' || source === 'library_ai') && context.libraryShots === 0) return 'Add clips to your B-roll library first.'
  if (source === 'stock' && !context.pexels) return 'Add a free Pexels key in Settings → API keys first.'
  if ((source === 'ai' || source === 'library_ai') && !context.openrouter) return 'Add your OpenRouter key in Settings → API keys first.'
  return null
}

/** The sources to offer: stock only when a Pexels key is saved. */
export function brollSourceOptions(context: BrollSourceContext): { id: BrollSource; label: string; detail: string; disabledReason: string | null }[] {
  return BROLL_SOURCES.filter((id) => id !== 'stock' || context.pexels)
    .map((id) => ({ id, label: BROLL_SOURCE_LABELS[id], detail: BROLL_SOURCE_DETAILS[id], disabledReason: brollSourceProblem(id, context) }))
}

/**
 * My library when it has shots, otherwise stock when a Pexels key is saved, otherwise none (null).
 * Never AI: AI shots cost money, so they run only when the member picks them.
 */
export function defaultBrollSource(context: Pick<BrollSourceContext, 'libraryShots' | 'pexels'>): BrollSource | null {
  if (context.libraryShots > 0) return 'library'
  return context.pexels ? 'stock' : null
}

/** The source a run uses: the member's pick when it can run, otherwise the default (never AI unless picked). */
export function effectiveBrollSource(picked: BrollSource | null | undefined, context: BrollSourceContext): BrollSource | null {
  if (picked && !brollSourceProblem(picked, context)) return picked
  return defaultBrollSource(context)
}

export const usesLibrary = (source: BrollSource): boolean => source === 'library' || source === 'library_ai'
export const usesAi = (source: BrollSource): boolean => source === 'ai' || source === 'library_ai'

// ---------------------------------------------------------------------------
// AI shots (OpenRouter video or image)
// ---------------------------------------------------------------------------

export interface BrollAiModel {
  id: string
  label: string
  /** OpenRouter's list price per second of video, when known (USD). */
  perSecondUsd: number | null
  /** The shot length asked for. */
  seconds: number
}

/** Video models on OpenRouter (POST /videos). Prices are list prices at the time of writing; OpenRouter reports the real cost. */
export const BROLL_AI_MODELS: readonly BrollAiModel[] = [
  { id: 'x-ai/grok-imagine-video-1.5-lite', label: 'Grok Imagine Video 1.5 Lite', perSecondUsd: 0.02, seconds: 5 },
  { id: 'bytedance/seedance-2.0-fast', label: 'Seedance 2.0 Fast', perSecondUsd: 0.04, seconds: 5 },
  { id: 'google/veo-3.1-lite', label: 'Veo 3.1 Lite', perSecondUsd: 0.05, seconds: 4 },
  { id: 'bytedance/seedance-2.0', label: 'Seedance 2.0', perSecondUsd: 0.07, seconds: 5 },
  { id: 'alibaba/wan-3.0', label: 'Wan 3.0', perSecondUsd: 0.05, seconds: 5 }
]
/** The cheapest one listed. */
export const DEFAULT_BROLL_AI_MODEL = 'x-ai/grok-imagine-video-1.5-lite'
/** "AI image + slow push-in": the image model the app already uses, and its estimate. */
export const BROLL_AI_IMAGE_MODEL = 'google/gemini-3.1-flash-image'
export const BROLL_AI_IMAGE_SECONDS = 4
export const MAX_AI_SHOTS_PER_CLIP = 6
export const DEFAULT_AI_SHOTS_PER_CLIP = 2

export type BrollAiKind = 'video' | 'image'
export interface BrollAiSettings {
  kind: BrollAiKind
  model: string
  /** At most this many AI shots per clip. */
  maxShots: number
}
export const DEFAULT_BROLL_AI_SETTINGS: BrollAiSettings = { kind: 'video', model: DEFAULT_BROLL_AI_MODEL, maxShots: DEFAULT_AI_SHOTS_PER_CLIP }

export function brollAiModel(id: string): BrollAiModel {
  return BROLL_AI_MODELS.find((model) => model.id === id) ?? BROLL_AI_MODELS.find((model) => model.id === DEFAULT_BROLL_AI_MODEL) as BrollAiModel
}

/** Saved settings, checked (unknown values fall back to the defaults). */
export function parseBrollAiSettings(value: unknown): BrollAiSettings {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const kind: BrollAiKind = v.kind === 'image' ? 'image' : 'video'
  const model = typeof v.model === 'string' && BROLL_AI_MODELS.some((entry) => entry.id === v.model) ? v.model : DEFAULT_BROLL_AI_MODEL
  const maxShots = typeof v.maxShots === 'number' && Number.isInteger(v.maxShots) && v.maxShots >= 0 && v.maxShots <= MAX_AI_SHOTS_PER_CLIP ? v.maxShots : DEFAULT_AI_SHOTS_PER_CLIP
  return { kind, model, maxShots }
}

/** Settings from the renderer: throws a plain message. */
export function checkBrollAiSettings(value: unknown): BrollAiSettings {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  if (!v) throw new Error('Choose the AI b-roll settings again.')
  if (v.kind !== 'video' && v.kind !== 'image') throw new Error('Choose AI video or AI image.')
  if (typeof v.model !== 'string' || !BROLL_AI_MODELS.some((entry) => entry.id === v.model)) throw new Error('Choose one of the listed video models.')
  if (typeof v.maxShots !== 'number' || !Number.isInteger(v.maxShots) || v.maxShots < 0 || v.maxShots > MAX_AI_SHOTS_PER_CLIP) throw new Error(`Choose 0 to ${MAX_AI_SHOTS_PER_CLIP} AI shots per clip.`)
  return { kind: v.kind, model: v.model, maxShots: v.maxShots }
}

/** One AI shot's estimate (USD), or null when the model's price isn't known. */
export function aiShotEstimateUsd(settings: BrollAiSettings): number | null {
  if (settings.kind === 'image') return PRICES.image
  const model = brollAiModel(settings.model)
  return model.perSecondUsd === null ? null : Math.round(model.perSecondUsd * model.seconds * 10_000) / 10_000
}

/** The most AI shots could cost for `clips` clips (null when the price isn't known). */
export function aiRunEstimateUsd(settings: BrollAiSettings, clips: number): number | null {
  const one = aiShotEstimateUsd(settings)
  if (one === null) return null
  return Math.round(one * settings.maxShots * Math.max(1, clips) * 100) / 100
}

/** "about $0.10 a shot, at most $0.20 a clip" (or the price note when it isn't known). */
export function aiEstimateLine(settings: BrollAiSettings): string {
  if (settings.maxShots === 0) return 'AI shots are off (0 per clip).'
  const one = aiShotEstimateUsd(settings)
  if (one === null) return `Up to ${settings.maxShots} AI shot${settings.maxShots === 1 ? '' : 's'} per clip. This model’s price isn’t listed here: see it on OpenRouter.`
  return `About $${one.toFixed(2)} a shot, at most $${(one * settings.maxShots).toFixed(2)} a clip (${settings.maxShots} shot${settings.maxShots === 1 ? '' : 's'}).`
}

/** The rules every AI b-roll prompt carries (the engine adds the same words). */
export const AI_PROMPT_RULES = 'Vertical 9:16 cinematic b-roll shot, natural light, smooth slow camera move. No text, no captions, no logos, no brand names, no watermarks. No real or famous people; any person is anonymous and seen from behind or at a distance.'

/** The prompt sent to OpenRouter for one AI shot. */
export function aiShotPrompt(prompt: string): string {
  const subject = cleanText(prompt, 400).replace(/["“”]/g, '')
  return `${subject}. ${AI_PROMPT_RULES}`
}

/** The OpenRouter video request for one AI b-roll shot (no audio, 9:16, 720p). */
export function brollVideoRequest(prompt: string, settings: BrollAiSettings): { model: string; prompt: string; aspectRatio: string; resolution: string; duration: number; generateAudio: boolean } {
  const model = brollAiModel(settings.model)
  return { model: model.id, prompt: aiShotPrompt(prompt), aspectRatio: '9:16', resolution: '720p', duration: model.seconds, generateAudio: false }
}

/** The OpenRouter image request for "AI image + slow push-in". */
export function brollImageRequest(prompt: string): { model: string; prompt: string; aspectRatio: string } {
  return { model: BROLL_AI_IMAGE_MODEL, prompt: aiShotPrompt(prompt), aspectRatio: '9:16' }
}
