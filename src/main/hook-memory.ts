import { app } from 'electron'
import { createHash, randomBytes } from 'crypto'
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { open } from 'fs/promises'
import { isAbsolute, join } from 'path'
import { MAX_HOOK_TEXT_CHARS } from '../shared/edit-recording'

/**
 * The headline each recording got last time (userData/hook-headlines.json), so making the same video again
 * (Edit my recording, Combine clips) keeps its headline instead of a new one from the AI every run. Keyed by
 * a fingerprint of the source files (size, length, first and last MB), never their paths or names. The member's
 * own changes (review, clip editor, Library) become the saved headline. Capped at the last 500 recordings.
 */

const FILE = 'hook-headlines.json'
const VERSION = 1
export const MAX_HOOK_MEMORY = 500
/** Runs remembered per recording (to find it again from the clip editor or the Library). */
const MAX_RUNS = 8
const SAMPLE_BYTES = 1024 * 1024
const KEY = /^(takes|combine):[0-9a-f]{64}$/
const RUN = /^edit-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export interface HookMemoryEntry { key: string; headline: string; runs: string[]; updatedAt: string }
/** One clip Create made from a video: its range of the source (ms) and its headline, and the run it is in. */
export interface CreateClip { start_ms: number; end_ms: number; headline: string; run: string }
/** Create (Automatic) runs of one video: the clips they made, newest last. */
export interface CreateEntry { key: string; clips: CreateClip[]; updatedAt: string }
export interface HookMemory { entries: HookMemoryEntry[]; create?: CreateEntry[] }

/** Videos whose Create clips are remembered, and clips per video (the newest kept). */
export const MAX_CREATE_SOURCES = 200
export const MAX_CREATE_CLIPS = 60
/** A new clip takes a saved one's headline when each covers at least this share of the other. */
export const CREATE_MIN_OVERLAP = 0.6
const CREATE_KEY = /^create:[0-9a-f]{64}$/
/** Create runs are named by their job id. */
const CREATE_RUN = /^[A-Za-z0-9_-]{1,128}$/

/** A headline as saved: one line of plain text, up to the hook text limit; '' when it isn't one. */
export function cleanHeadline(value: unknown): string {
  if (typeof value !== 'string') return ''
  const text = value.replace(/\s+/g, ' ').trim()
  // eslint-disable-next-line no-control-regex
  if (!text || text.length > MAX_HOOK_TEXT_CHARS || /[\u0000-\u001f\u007f<>{}\\]/.test(text)) return ''
  return text
}

/** The saved file, checked: anything malformed is dropped (an unreadable file is an empty memory). */
export function parseHookMemory(raw: unknown): HookMemory {
  const list = raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as { version?: unknown }).version === VERSION ? (raw as { entries?: unknown }).entries : null
  const entries: HookMemoryEntry[] = []
  for (const item of Array.isArray(list) ? list.slice(-MAX_HOOK_MEMORY * 2) : []) {
    if (!item || typeof item !== 'object') continue
    const { key, headline, runs, updatedAt } = item as Record<string, unknown>
    const text = cleanHeadline(headline)
    if (typeof key !== 'string' || !KEY.test(key) || !text || entries.some((entry) => entry.key === key)) continue
    entries.push({ key, headline: text, runs: Array.isArray(runs) ? runs.filter((run): run is string => typeof run === 'string' && RUN.test(run)).slice(-MAX_RUNS) : [],
      updatedAt: typeof updatedAt === 'string' && updatedAt.length <= 40 && Number.isFinite(Date.parse(updatedAt)) ? updatedAt : new Date(0).toISOString() })
  }
  const create: CreateEntry[] = []
  const rawCreate = raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as { version?: unknown }).version === VERSION ? (raw as { create?: unknown }).create : null
  for (const item of Array.isArray(rawCreate) ? rawCreate.slice(-MAX_CREATE_SOURCES * 2) : []) {
    if (!item || typeof item !== 'object') continue
    const { key, clips, updatedAt } = item as Record<string, unknown>
    if (typeof key !== 'string' || !CREATE_KEY.test(key) || create.some((entry) => entry.key === key)) continue
    const kept = (Array.isArray(clips) ? clips : []).map(parseCreateClip).filter((clip): clip is CreateClip => clip !== null).slice(-MAX_CREATE_CLIPS)
    if (!kept.length) continue
    create.push({ key, clips: kept, updatedAt: typeof updatedAt === 'string' && updatedAt.length <= 40 && Number.isFinite(Date.parse(updatedAt)) ? updatedAt : new Date(0).toISOString() })
  }
  return { entries: entries.slice(-MAX_HOOK_MEMORY), ...(create.length ? { create: create.slice(-MAX_CREATE_SOURCES) } : {}) }
}

function parseCreateClip(value: unknown): CreateClip | null {
  if (!value || typeof value !== 'object') return null
  const { start_ms: start, end_ms: end, headline, run } = value as Record<string, unknown>
  const text = cleanHeadline(headline)
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || (start as number) < 0 || (end as number) <= (start as number) || !text) return null
  if (typeof run !== 'string' || !CREATE_RUN.test(run)) return null
  return { start_ms: start as number, end_ms: end as number, headline: text, run }
}

/** How much two ranges share, as a share of the longer one (0-1): both must cover most of each other. */
export function rangeOverlap(a: readonly [number, number], b: readonly [number, number]): number {
  const shared = Math.min(a[1], b[1]) - Math.max(a[0], b[0])
  const longest = Math.max(a[1] - a[0], b[1] - b[0])
  return longest > 0 ? Math.max(0, shared) / longest : 0
}

/** The saved clip a range overlaps most (at least CREATE_MIN_OVERLAP), or null. `run`: only that run's clips. */
export function matchCreateClip(clips: readonly CreateClip[], range: readonly [number, number], run?: string): CreateClip | null {
  let best: CreateClip | null = null
  let score = 0
  for (const clip of clips) {
    if (run !== undefined && clip.run !== run) continue
    const share = rangeOverlap(range, [clip.start_ms, clip.end_ms])
    if (share > score) { best = clip; score = share }
  }
  return best && score >= CREATE_MIN_OVERLAP ? best : null
}

/**
 * The memory with a Create run's clips saved for its video: each new clip replaces the saved ones it overlaps
 * (the same moment), the rest are kept; newest last, capped.
 */
export function withCreateClips(memory: HookMemory, key: string, run: string, clips: readonly { start_ms: number; end_ms: number; headline: unknown }[], now = new Date()): HookMemory {
  if (!CREATE_KEY.test(key) || !CREATE_RUN.test(run)) return memory
  const fresh = clips.map((clip) => parseCreateClip({ ...clip, run })).filter((clip): clip is CreateClip => clip !== null)
  if (!fresh.length) return memory
  const list = memory.create ?? []
  const old = list.find((entry) => entry.key === key)?.clips ?? []
  const kept = old.filter((clip) => !fresh.some((item) => rangeOverlap([item.start_ms, item.end_ms], [clip.start_ms, clip.end_ms]) >= CREATE_MIN_OVERLAP))
  const entry: CreateEntry = { key, clips: [...kept, ...fresh].slice(-MAX_CREATE_CLIPS), updatedAt: now.toISOString() }
  return { ...memory, create: [...list.filter((item) => item.key !== key), entry].slice(-MAX_CREATE_SOURCES) }
}

/** The memory with the member's own headline for a Create clip (the run's clip that covers `range`). Null when none matches. */
export function withCreateHeadline(memory: HookMemory, run: string, range: readonly [number, number], headline: unknown, now = new Date()): HookMemory | null {
  const text = cleanHeadline(headline)
  if (!text || !CREATE_RUN.test(run)) return null
  for (const entry of memory.create ?? []) {
    const clip = matchCreateClip(entry.clips, range, run)
    if (!clip) continue
    const updated: CreateEntry = { ...entry, clips: entry.clips.map((item) => item === clip ? { ...item, headline: text } : item), updatedAt: now.toISOString() }
    return { ...memory, create: [...(memory.create ?? []).filter((item) => item !== entry), updated] }
  }
  return null
}

/** The memory with `headline` saved for `key` (most recent last; the oldest go past the cap). */
export function withHeadline(memory: HookMemory, key: string, headline: string, run: string | null, now = new Date()): HookMemory {
  const text = cleanHeadline(headline)
  if (!KEY.test(key) || !text) return memory
  const old = memory.entries.find((entry) => entry.key === key)
  const runs = [...(old?.runs ?? []).filter((item) => item !== run), ...(run && RUN.test(run) ? [run] : [])].slice(-MAX_RUNS)
  const entries = [...memory.entries.filter((entry) => entry.key !== key), { key, headline: text, runs, updatedAt: now.toISOString() }]
  return { ...memory, entries: entries.slice(-MAX_HOOK_MEMORY) }
}

function memoryPath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  return join(dir, FILE)
}

function read(): HookMemory {
  try { return parseHookMemory(JSON.parse(readFileSync(memoryPath(), 'utf8'))) } catch { return { entries: [] } }
}

function write(memory: HookMemory): void {
  const path = memoryPath()
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`
  try {
    writeFileSync(temp, JSON.stringify({ version: VERSION, entries: memory.entries, ...(memory.create?.length ? { create: memory.create } : {}) }), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    renameSync(temp, path)
  } finally {
    if (existsSync(temp)) rmSync(temp, { force: true })
  }
}

/** One file's fingerprint: its size, its length (seconds, to the millisecond) and its first and last MB. */
async function fileFingerprint(path: string, seconds: number): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    const hash = createHash('sha256').update(`${size}\n${Math.round(seconds * 1000)}\n`)
    const head = Buffer.alloc(Math.min(SAMPLE_BYTES, size))
    await handle.read(head, 0, head.length, 0)
    hash.update(head)
    if (size > SAMPLE_BYTES) {
      const tail = Buffer.alloc(Math.min(SAMPLE_BYTES, size - SAMPLE_BYTES))
      await handle.read(tail, 0, tail.length, size - tail.length)
      hash.update(tail)
    }
    return hash.digest('hex')
  } finally { await handle.close() }
}

/**
 * The key for a set of recordings made into one video: the same files (in any order, wherever they are, whatever
 * they're called) give the same key. Retakes and combined clips are kept apart. Null when a file can't be read.
 */
export async function sourcesKey(mode: 'takes' | 'combine', sources: { path: string; seconds: number }[]): Promise<string | null> {
  if (!sources.length) return null
  try {
    const prints = await Promise.all(sources.map((source) => fileFingerprint(source.path, source.seconds)))
    return `${mode}:${createHash('sha256').update(prints.sort().join('\n')).digest('hex')}`
  } catch { return null }
}

/** The headline saved for these recordings, or null. */
export function savedHeadline(key: string | null): string | null {
  if (!key) return null
  return read().entries.find((entry) => entry.key === key)?.headline ?? null
}

/** Save the headline a video was made with (an empty one leaves the saved one as it is). Never throws. */
export function rememberHeadline(key: string | null, headline: unknown, run: string | null = null): void {
  if (!key || !cleanHeadline(headline)) return
  try { write(withHeadline(read(), key, headline as string, run)) } catch { /* a headline that can't be saved is only not kept */ }
}

/** The member changed a made video's headline (clip editor, Library): it becomes the saved one for its recordings. */
export function rememberRunHeadline(run: string, headline: unknown): boolean {
  if (!RUN.test(run) || !cleanHeadline(headline)) return false
  try {
    const memory = read()
    const entry = memory.entries.find((item) => item.runs.includes(run))
    if (!entry) return false
    write(withHeadline(memory, entry.key, headline as string, run))
    return true
  } catch { return false }
}

// ---------------------------------------------------------------------------
// Create (Automatic): the same video made again keeps its clips' headlines
// ---------------------------------------------------------------------------

/** A YouTube link's video id, so every form of the link (watch, youtu.be, shorts, extra parameters) is one video. */
function youtubeId(url: URL): string | null {
  const host = url.hostname.replace(/^(www|m|music)\./, '')
  const id = host === 'youtu.be' ? url.pathname.slice(1) : host === 'youtube.com' ? (url.searchParams.get('v') ?? /^\/(?:shorts|live|embed)\/([^/]+)/.exec(url.pathname)?.[1] ?? '') : ''
  return /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null
}

/**
 * The key for a Create source: a local file's fingerprint (its size and first and last MB, never its path or name),
 * or a link's video (YouTube by its id, other links without their parameters). Null when it can't be told.
 */
export function createSourceKey(source: unknown): string | null {
  if (typeof source !== 'string' || !source.trim() || source.length > 8192) return null
  const hash = (text: string | Buffer, kind: string): string => `create:${createHash('sha256').update(kind).update('\n').update(text).digest('hex')}`
  if (isAbsolute(source)) {
    try {
      if (!statSync(source).isFile()) return null
      const fd = openSync(source, 'r')
      try {
        const { size } = fstatSync(fd)
        const head = Buffer.alloc(Math.min(SAMPLE_BYTES, size))
        readSync(fd, head, 0, head.length, 0)
        const tail = Buffer.alloc(size > SAMPLE_BYTES ? Math.min(SAMPLE_BYTES, size - SAMPLE_BYTES) : 0)
        if (tail.length) readSync(fd, tail, 0, tail.length, size - tail.length)
        return hash(Buffer.concat([Buffer.from(`${size}\n`), head, tail]), 'file')
      } finally { closeSync(fd) }
    } catch { return null }
  }
  try {
    const url = new URL(source)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    const id = youtubeId(url)
    return id ? hash(id, 'youtube') : hash(`${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, '')}`, 'url')
  } catch { return null }
}

/** The headlines saved for a video's Create clips, for the engine ([{start_ms, end_ms, headline}], newest last). */
export function savedCreateHeadlines(key: string | null): { start_ms: number; end_ms: number; headline: string }[] {
  if (!key) return []
  const entry = read().create?.find((item) => item.key === key)
  return (entry?.clips ?? []).map(({ start_ms, end_ms, headline }) => ({ start_ms, end_ms, headline }))
}

/** Save the clips a Create run made from a video (their ranges and headlines). Never throws. */
export function rememberCreateRun(key: string | null, run: string, clips: readonly { start_time_ms: number; end_time_ms: number; headline?: string | null }[]): void {
  if (!key) return
  try {
    const next = withCreateClips(read(), key, run, clips.map((clip) => ({ start_ms: Math.round(clip.start_time_ms), end_ms: Math.round(clip.end_time_ms), headline: clip.headline ?? '' })))
    write(next)
  } catch { /* only not remembered */ }
}

/** The member changed a Create clip's headline (clip editor, Library): it becomes the saved one for that moment. */
export function rememberCreateHeadline(run: string, range: readonly [number, number], headline: unknown): boolean {
  if (!CREATE_RUN.test(run) || !(range[1] > range[0])) return false
  try {
    const next = withCreateHeadline(read(), run, range, headline)
    if (!next) return false
    write(next)
    return true
  } catch { return false }
}
