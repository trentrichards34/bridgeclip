import { app } from 'electron'
import { execFile } from 'child_process'
import { randomBytes } from 'crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'fs'
import { lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { basename, extname, isAbsolute, join } from 'path'
import { promisify } from 'util'
import {
  aiRunEstimateUsd, ANALYSIS_SCHEMA, BROLL_AI_IMAGE_MODEL, BROLL_LIBRARY_VERSION, BROLL_AI_IMAGE_SECONDS, brollAiModel, brollSourceProblem, usesAi, usesLibrary, type BrollSource, brollImageRequest, brollVideoRequest, buildCatalog, checkBrollAiSettings, cleanTags, cleanText,
  FRAMES_PER_SHOT, isLibraryItemId, libraryMediaKind, MAX_ADD_FILES, MAX_FOLDER_DEPTH, MAX_LIBRARY_ITEMS, MAX_NAME_CHARS, parseAnalysis, parseBrollAiSettings,
  parseLibraryIndex, pendingShots, shotsFromScenes, SPLIT_LONGER_THAN_S, type BrollAiSettings, type BrollAnalysis, type BrollCatalog, type BrollIndexProgress, type BrollLibraryEntry,
  type BrollLibraryIndex, type BrollLibraryItem, type BrollLibraryView, type BrollShotRange
} from '../shared/broll-library'
import { PRICES } from '../shared/avatars'
import { logger } from './logger'
import { MOMENT_HELPER_MODEL } from './moment-take'
import { generateImage, generateVideo, openRouterBase, reportOpenRouterUsage, type MediaOptions } from './openrouter-media'
import { authorizeMedia, isWithinDirectory } from './security'
import { loadSettings, saveSettings } from './settings-store'
import { resolveBinary } from './tools'

const execFileAsync = promisify(execFile)

/**
 * My B-roll library (shared/broll-library.ts has the data shapes and checks).
 *
 *   userData/broll-library/index.json    the index (versioned; temp file + rename)
 *                          proxies/      a 720p H.264 copy of each video (no sound), or a small JPEG of each picture
 *                          posters/      one frame of each, for the grid
 *                          ai/           AI shots made for the member (these files belong to the library)
 *                          incoming/     AI shots the engine made during a run, waiting to join the index
 *
 * Originals are used where they are. Every change goes through `mutate`, one at a time, so two adds, a rename
 * and the indexer never overwrite each other. Main is the only writer of index.json.
 */

/** The vision model the app already uses for quick looks at frames (the engine's layout vision model too). */
export const BROLL_VISION_MODEL = MOMENT_HELPER_MODEL
const MAX_INDEX_BYTES = 30 * 1024 * 1024
const MAX_VIDEO_SECONDS = 3 * 3600
const MAX_ORIGINAL_BYTES = 20 * 1024 * 1024 * 1024
const INDEX_CONCURRENCY = 3
const FRAME_WIDTH = 512
const VIDEO_INPUT_GUARD = ['-protocol_whitelist', 'file,pipe,fd', '-format_whitelist', 'mov,matroska,webm,avi,flv,mpegts']
const IMAGE_INPUT_GUARD = ['-protocol_whitelist', 'file,pipe,fd', '-f', 'image2']

export function libraryRoot(): string { return join(app.getPath('userData'), 'broll-library') }
const indexPath = (): string => join(libraryRoot(), 'index.json')
const dirOf = (name: 'proxies' | 'posters' | 'ai' | 'incoming'): string => join(libraryRoot(), name)

// ---------------------------------------------------------------------------
// The index: loaded once, changed one at a time
// ---------------------------------------------------------------------------

let index: BrollLibraryIndex | null = null
let queue: Promise<unknown> = Promise.resolve()
const listeners = new Set<() => void>()
const progressListeners = new Set<(progress: BrollIndexProgress) => void>()

/** Called after every change (the IPC layer tells the page). */
export function onLibraryChange(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener) }
export function onIndexProgress(listener: (progress: BrollIndexProgress) => void): () => void { progressListeners.add(listener); return () => progressListeners.delete(listener) }
function changed(): void { for (const listener of listeners) { try { listener() } catch { /* never breaks a change */ } } }

async function readIndex(): Promise<BrollLibraryIndex> {
  if (index) return index
  let parsed: BrollLibraryIndex = { version: BROLL_LIBRARY_VERSION, items: [] }
  try {
    const info = await lstat(indexPath())
    if (!info.isFile() || info.size > MAX_INDEX_BYTES) throw new Error('unreadable')
    const raw = JSON.parse(await readFile(indexPath(), 'utf8')) as unknown
    parsed = parseLibraryIndex(raw)
    const version = (raw as { version?: unknown } | null)?.version
    // A damaged or newer index is kept aside, never overwritten.
    if (version !== BROLL_LIBRARY_VERSION) await keepAside()
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') { logger.warn('broll.index.unreadable', { message: String((error as Error)?.message ?? error).slice(0, 120) }); await keepAside() }
  }
  index = parsed
  return parsed
}

async function keepAside(): Promise<void> {
  try { await rename(indexPath(), `${indexPath()}.unreadable-${Date.now()}`) } catch { /* nothing to keep */ }
}

async function writeIndex(value: BrollLibraryIndex): Promise<void> {
  await mkdir(libraryRoot(), { recursive: true, mode: 0o700 })
  const temp = `${indexPath()}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(temp, JSON.stringify(value), { mode: 0o600 })
  await rename(temp, indexPath())
}

/** Change the index (one change at a time) and save it. */
function mutate<T>(work: (value: BrollLibraryIndex) => T | Promise<T>): Promise<T> {
  const next = queue.then(async () => {
    const value = await readIndex()
    const result = await work(value)
    await writeIndex(value)
    return result
  })
  queue = next.catch(() => undefined)
  return next.finally(changed)
}

async function snapshot(): Promise<BrollLibraryItem[]> {
  await queue
  return (await readIndex()).items.map((item) => structuredClone(item))
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

function regularFile(path: string): { size: number; mtimeMs: number } | null {
  try {
    const info = lstatSync(path)
    return info.isFile() && !info.isSymbolicLink() && info.size > 0 ? { size: info.size, mtimeMs: info.mtimeMs } : null
  } catch { return null }
}

/** The original file when it's still there (a symlinked original is followed: the member chose it). */
function originalFile(item: BrollLibraryItem): string | null {
  try {
    const real = realpathSync(item.original)
    const info = statSync(real)
    return info.isFile() && info.size > 0 ? real : null
  } catch { return null }
}

function proxyFile(item: BrollLibraryItem): string | null {
  return item.proxy && regularFile(join(dirOf('proxies'), item.proxy)) ? join(dirOf('proxies'), item.proxy) : null
}
function posterFile(item: BrollLibraryItem): string | null {
  return item.poster && regularFile(join(dirOf('posters'), item.poster)) ? join(dirOf('posters'), item.poster) : null
}

/** The file to cut shots from: the original, or the proxy when the original is gone. */
export function usableFile(item: BrollLibraryItem): string | null {
  return originalFile(item) ?? proxyFile(item)
}

function authorized(path: string | null): string | null {
  if (!path) return null
  try { return authorizeMedia(path) } catch { return null }
}

let encoderArgs: string[] | null = null
async function h264Args(): Promise<string[]> {
  if (encoderArgs) return encoderArgs
  let encoders = ''
  try { encoders = (await execFileAsync(resolveBinary('ffmpeg'), ['-hide_banner', '-encoders'], { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 })).stdout } catch { /* the encode below reports it */ }
  const has = (name: string): boolean => new RegExp(`^\\s*V\\S*\\s+${name}\\s`, 'm').test(encoders)
  encoderArgs = has('libx264') ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28']
    : has('libopenh264') ? ['-c:v', 'libopenh264', '-b:v', '1500k']
      : has('h264_videotoolbox') ? ['-c:v', 'h264_videotoolbox', '-allow_sw', '1', '-b:v', '1500k']
        : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28']
  return encoderArgs
}

async function ffmpeg(args: string[], timeoutMs = 30 * 60_000, signal?: AbortSignal): Promise<string> {
  const { stderr } = await execFileAsync(resolveBinary('ffmpeg'), ['-nostdin', '-hide_banner', '-y', ...args], { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, signal })
  return stderr
}

interface Probe { durationS: number; width: number; height: number }

async function probe(path: string, kind: 'video' | 'image'): Promise<Probe> {
  const { stdout } = await execFileAsync(resolveBinary('ffprobe'), ['-v', 'error', ...(kind === 'video' ? VIDEO_INPUT_GUARD : IMAGE_INPUT_GUARD),
    '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', path], { timeout: 60_000, maxBuffer: 1024 * 1024 })
  const json = JSON.parse(stdout) as { streams?: { width?: unknown; height?: unknown }[]; format?: { duration?: unknown } }
  const width = Number(json.streams?.[0]?.width), height = Number(json.streams?.[0]?.height)
  if (!(width > 0 && height > 0)) throw new Error('No picture was found in this file.')
  const durationS = kind === 'video' ? Number(json.format?.duration) : 0
  if (kind === 'video' && !(durationS > 0)) throw new Error('This video’s length could not be read.')
  if (durationS > MAX_VIDEO_SECONDS) throw new Error('Videos up to 3 hours long can be added.')
  return { durationS, width, height }
}

/** Scene changes (seconds) in a video, from its proxy. */
async function sceneChanges(path: string): Promise<number[]> {
  const stderr = await ffmpeg([...VIDEO_INPUT_GUARD, '-i', path, '-an', '-vf', "select='gt(scene,0.3)',showinfo", '-f', 'null', '-'])
  return [...stderr.matchAll(/pts_time:([0-9.]+)/g)].map((match) => Number(match[1])).filter((t) => Number.isFinite(t))
}

/** Make the item's proxy and poster, and split it into shots. */
async function prepare(item: BrollLibraryItem): Promise<Pick<BrollLibraryItem, 'proxy' | 'poster' | 'durationS' | 'width' | 'height' | 'size' | 'mtimeMs' | 'shots'>> {
  const source = originalFile(item)
  if (!source) throw new Error('The file is no longer there.')
  const file = statSync(source)
  if (file.size > MAX_ORIGINAL_BYTES) throw new Error('Files up to 20 GB can be added.')
  const info = await probe(source, item.kind)
  await mkdir(dirOf('proxies'), { recursive: true, mode: 0o700 })
  await mkdir(dirOf('posters'), { recursive: true, mode: 0o700 })
  const tag = randomBytes(3).toString('hex')
  const proxy = `${item.id}-${tag}.${item.kind === 'video' ? 'mp4' : 'jpg'}`, poster = `${item.id}-${tag}.jpg`
  const proxyPath = join(dirOf('proxies'), proxy), posterPath = join(dirOf('posters'), poster)
  const partial = `${proxyPath}.part.${item.kind === 'video' ? 'mp4' : 'jpg'}`
  try {
    if (item.kind === 'video') {
      // 720 on the short side (never upscaled), even sizes, 30 fps at most, no sound.
      const scale = info.width >= info.height ? "scale=-2:'min(720,ih)'" : "scale='min(720,iw)':-2"
      await ffmpeg([...VIDEO_INPUT_GUARD, '-i', source, '-map', '0:v:0', '-an', '-sn', '-vf', `${scale},format=yuv420p`, ...(await h264Args()), '-movflags', '+faststart', partial])
    } else {
      await ffmpeg([...IMAGE_INPUT_GUARD, '-i', source, '-frames:v', '1', '-vf', "scale='min(1280,iw)':-2", '-q:v', '3', partial], 120_000)
    }
    await rename(partial, proxyPath)
    const at = item.kind === 'video' ? Math.min(Math.max(0, info.durationS * 0.3), Math.max(0, info.durationS - 0.1)) : 0
    await ffmpeg([...(item.kind === 'video' ? VIDEO_INPUT_GUARD : IMAGE_INPUT_GUARD), ...(item.kind === 'video' ? ['-ss', at.toFixed(2)] : []), '-i', proxyPath, '-frames:v', '1', '-vf', "scale='min(360,iw)':-2", '-q:v', '4', posterPath], 120_000)
  } catch (error) {
    await Promise.all([rm(partial, { force: true }), rm(proxyPath, { force: true }), rm(posterPath, { force: true })])
    throw error
  }
  // Long clips are split at scene changes (found on the proxy, which is quick to read).
  const ranges = item.kind === 'image' ? [{ inS: 0, outS: 0 }]
    : shotsFromScenes(info.durationS, info.durationS > SPLIT_LONGER_THAN_S ? await sceneChanges(proxyPath).catch(() => []) : [])
  const shots: BrollShotRange[] = ranges.map((range, i) => ({ id: `s${i}`, inS: range.inS, outS: range.outS, analysis: item.origin === 'ai' ? promptAnalysis(item) : null }))
  return { proxy, poster, durationS: info.durationS, width: info.width, height: info.height, size: file.size, mtimeMs: file.mtimeMs, shots }
}

/** An AI shot is described by what was asked for (nothing is made up about it). */
function promptAnalysis(item: BrollLibraryItem): BrollAnalysis | null {
  if (!item.aiPrompt) return null
  const words = cleanTags(item.aiPrompt.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 3), 8)
  return {
    description: item.aiPrompt.slice(0, 300), tags: ['ai', ...words].slice(0, 12), subjects: [], setting: '', shotType: 'other', motion: 'slow', mood: '',
    memberAppears: false, onScreenText: '', quality: '', model: item.aiModel ?? '', analyzedAt: new Date().toISOString()
  }
}

async function removeFiles(item: Pick<BrollLibraryItem, 'proxy' | 'poster'>): Promise<void> {
  if (item.proxy) await rm(join(dirOf('proxies'), item.proxy), { force: true }).catch(() => undefined)
  if (item.poster) await rm(join(dirOf('posters'), item.poster), { force: true }).catch(() => undefined)
}

// ---------------------------------------------------------------------------
// Preparing new items (free, local): one at a time in the background
// ---------------------------------------------------------------------------

let preparing: Promise<void> | null = null

/** Make proxies, posters and shots for every new item. Resolves when the queue is empty. */
export function prepareNewItems(): Promise<void> {
  preparing ??= (async () => {
    try {
      for (;;) {
        const next = (await snapshot()).find((item) => item.status === 'new')
        if (!next) return
        let result: Awaited<ReturnType<typeof prepare>> | null = null, error = ''
        try { result = await prepare(next) } catch (failure) {
          error = cleanText((failure as Error)?.message, 200)
          if (!error || /ffmpeg|ffprobe|Command failed/i.test(error)) error = 'This file could not be read as a video or picture.'
          logger.warn('broll.prepare.failed', { id: next.id, message: String((failure as Error)?.message ?? failure).slice(0, 200) })
        }
        await mutate(async (value) => {
          const item = value.items.find((entry) => entry.id === next.id)
          if (!item) { if (result) await removeFiles(result); return }
          await removeFiles(item)
          if (result) { Object.assign(item, result, { status: 'ready' }); delete item.error }
          else { item.status = 'failed'; item.error = error; item.shots = []; item.proxy = null; item.poster = null }
        })
      }
    } finally { preparing = null }
  })()
  return preparing
}

/** Originals that changed since they were looked at go back to be prepared (and looked at) again. */
async function refreshChanged(): Promise<void> {
  const items = await snapshot()
  const stale = items.filter((item) => {
    if (item.status !== 'ready' || item.origin === 'ai') return false
    const real = originalFile(item)
    if (!real) return false
    const info = statSync(real)
    return Math.round(info.size) !== Math.round(item.size) || Math.abs(info.mtimeMs - item.mtimeMs) > 1500
  }).map((item) => item.id)
  if (!stale.length) return
  await mutate((value) => { for (const item of value.items) if (stale.includes(item.id)) { item.status = 'new'; item.shots = [] } })
  void prepareNewItems()
}

// ---------------------------------------------------------------------------
// What the page sees
// ---------------------------------------------------------------------------

function entry(item: BrollLibraryItem): BrollLibraryEntry {
  const original = originalFile(item)
  return {
    ...item, missing: !original && item.status !== 'new',
    proxyPath: authorized(proxyFile(item)), posterPath: authorized(posterFile(item)), originalPath: authorized(original)
  }
}

let progress: BrollIndexProgress | null = null

export async function libraryView(): Promise<BrollLibraryView> {
  await adoptIncoming().catch((error: unknown) => logger.warn('broll.incoming.failed', { message: String((error as Error)?.message ?? error).slice(0, 200) }))
  await refreshChanged().catch(() => undefined)
  const items = await snapshot()
  if (items.some((item) => item.status === 'new')) void prepareNewItems()
  return {
    items: items.map(entry).sort((a, b) => b.addedAt.localeCompare(a.addedAt)),
    pendingShots: pendingShots(items).length,
    usableShots: buildCatalog(items, usableFile).shots.length,
    preparing: items.filter((item) => item.status === 'new').length,
    indexing: progress,
    ai: brollAiSettings()
  }
}

/** All items (copies), for other main modules: the B-roll maker, Remix. */
export async function libraryItems(): Promise<BrollLibraryItem[]> { return snapshot() }

/** How many analyzed shots the planner could use. */
export async function libraryShotCount(): Promise<number> {
  return buildCatalog(await snapshot(), usableFile).shots.length
}

/** The catalog the engine reads (only analyzed shots whose file is there). */
export async function libraryCatalog(): Promise<BrollCatalog> {
  return buildCatalog(await snapshot(), usableFile)
}

/** Write the catalog for one run into its private folder. Null when the library has no usable shots. */
export async function writeRunCatalog(folder: string): Promise<{ path: string; shots: number } | null> {
  const catalog = await libraryCatalog()
  if (!catalog.shots.length) return null
  await mkdir(folder, { recursive: true, mode: 0o700 })
  const path = join(folder, 'broll-catalog.json')
  const temp = `${path}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(temp, JSON.stringify(catalog), { mode: 0o600 })
  await rename(temp, path)
  return { path, shots: catalog.shots.length }
}

/** The index without waiting (for a run starting now): what is in memory, or index.json as saved. */
function indexSync(): BrollLibraryIndex {
  if (index) return index
  try {
    const info = lstatSync(indexPath())
    if (!info.isFile() || info.size > MAX_INDEX_BYTES) return { version: BROLL_LIBRARY_VERSION, items: [] }
    return parseLibraryIndex(JSON.parse(readFileSync(indexPath(), 'utf8')))
  } catch { return { version: BROLL_LIBRARY_VERSION, items: [] } }
}

/** Usable shots right now (no waiting), e.g. to pick the default b-roll source. */
export function libraryShotCountSync(): number {
  return buildCatalog(indexSync().items, usableFile).shots.length
}

/**
 * The engine fields for a run with b-roll: where it comes from, the library catalog (written into the run's private
 * work folder), the AI settings and where AI shots are left for the library. A source that can't run gives the
 * plain reason. Requests from before sources existed (no source) use stock footage, as they did.
 */
export function brollRunFields(source: BrollSource | undefined, keys: { pexels: boolean; openrouter: boolean }, workFolder: string): { fields: Record<string, unknown> } | { error: string } {
  const catalog = buildCatalog(indexSync().items, usableFile)
  const picked: BrollSource = source ?? 'stock'
  const problem = brollSourceProblem(picked, { libraryShots: catalog.shots.length, pexels: keys.pexels, openrouter: keys.openrouter })
  if (problem) return { error: picked === 'stock' ? 'B-roll needs a free Pexels API key. Add it in Settings → API keys, then run the job again.' : `B-roll: ${problem}` }
  const fields: Record<string, unknown> = { broll_source: picked }
  if (usesLibrary(picked)) {
    mkdirSync(workFolder, { recursive: true, mode: 0o700 })
    const path = join(workFolder, 'broll-catalog.json')
    const temp = `${path}.${randomBytes(4).toString('hex')}.tmp`
    writeFileSync(temp, JSON.stringify(catalog), { mode: 0o600 })
    renameSync(temp, path)
    fields.broll_catalog_path = path
  }
  if (usesAi(picked)) {
    const ai = brollAiSettings()
    const model = brollAiModel(ai.model)
    mkdirSync(dirOf('incoming'), { recursive: true, mode: 0o700 })
    fields.broll_ai = { kind: ai.kind, model: ai.kind === 'image' ? BROLL_AI_IMAGE_MODEL : model.id, max_shots: ai.maxShots, seconds: ai.kind === 'image' ? BROLL_AI_IMAGE_SECONDS : model.seconds,
      per_second_usd: ai.kind === 'image' ? null : model.perSecondUsd, image_usd: PRICES.image }
    fields.broll_ai_dir = dirOf('incoming')
  }
  return { fields }
}

/** The most a run's AI b-roll could cost (for the spending check), or null. */
export function brollRunEstimateUsd(source: BrollSource | undefined, clips: number): number | null {
  if (!source || !usesAi(source)) return null
  return aiRunEstimateUsd(brollAiSettings(), clips)
}

/** Where the engine leaves AI shots it made during a run (they join the library on the next look). */
export async function incomingFolder(): Promise<string> {
  await mkdir(dirOf('incoming'), { recursive: true, mode: 0o700 })
  return dirOf('incoming')
}

// ---------------------------------------------------------------------------
// Adding, renaming, tagging, removing
// ---------------------------------------------------------------------------

/** Media files in a folder (not following links, skipping hidden files), up to the limits. */
async function walk(folder: string, depth: number, found: string[]): Promise<void> {
  if (depth > MAX_FOLDER_DEPTH || found.length >= MAX_ADD_FILES) return
  let names: string[]
  try { names = (await readdir(folder)).sort() } catch { return }
  for (const name of names) {
    if (found.length >= MAX_ADD_FILES) return
    if (name.startsWith('.')) continue
    const path = join(folder, name)
    let info
    try { info = await lstat(path) } catch { continue }
    if (info.isSymbolicLink()) continue
    if (info.isDirectory()) await walk(path, depth + 1, found)
    else if (info.isFile() && libraryMediaKind(name)) found.push(path)
  }
}

export interface AddResult { added: number; skipped: number; view: BrollLibraryView }

/**
 * Add files or folders (paths from the file dialog). Each must be an absolute path to a video, a picture or a folder
 * of them; files already in the library, inside the app's own folders or in the output folder's runs are skipped.
 */
export async function addLibraryPaths(paths: unknown): Promise<AddResult> {
  if (!Array.isArray(paths) || !paths.length || paths.length > MAX_ADD_FILES) throw new Error('Choose videos, pictures or a folder of them.')
  const files: string[] = []
  for (const raw of paths) {
    if (typeof raw !== 'string' || !isAbsolute(raw) || raw.includes('\0') || raw.length > 4096) throw new Error('Choose videos, pictures or a folder of them.')
    let info
    try { info = await stat(raw) } catch { continue }
    if (info.isDirectory()) await walk(raw, 1, files)
    else if (info.isFile() && libraryMediaKind(basename(raw))) files.push(raw)
  }
  let skipped = 0
  const root = libraryRoot()
  const added = await mutate((value) => {
    const known = new Set(value.items.map((item) => { try { return realpathSync(item.original) } catch { return item.original } }))
    let count = 0
    for (const file of files) {
      let real: string
      try { real = realpathSync(file) } catch { skipped++; continue }
      const kind = libraryMediaKind(basename(real)) ?? libraryMediaKind(basename(file))
      if (!kind || known.has(real) || (existsSync(root) && isWithinDirectory(real, root))) { skipped++; continue }
      if (value.items.length >= MAX_LIBRARY_ITEMS) { skipped++; continue }
      const info = statSync(real)
      known.add(real)
      value.items.push({
        id: `l${randomBytes(6).toString('hex')}`, kind, name: cleanText(basename(file, extname(file)), MAX_NAME_CHARS) || 'Untitled', original: real,
        proxy: null, poster: null, durationS: 0, width: 0, height: 0, size: info.size, mtimeMs: info.mtimeMs,
        addedAt: new Date().toISOString(), origin: 'member', tags: [], me: false, shots: [], status: 'new'
      })
      count++
    }
    return count
  })
  if (added) void prepareNewItems()
  logger.info('broll.added', { added, skipped })
  return { added, skipped, view: await libraryView() }
}

export async function updateLibraryItem(id: unknown, patch: unknown): Promise<BrollLibraryView> {
  if (!isLibraryItemId(id)) throw new Error('That clip is no longer in your library.')
  const p = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch as Record<string, unknown> : null
  if (!p) throw new Error('Nothing to change.')
  if (p.name !== undefined && (typeof p.name !== 'string' || !cleanText(p.name, MAX_NAME_CHARS))) throw new Error('Give it a name.')
  if (p.tags !== undefined && (!Array.isArray(p.tags) || p.tags.length > 40)) throw new Error('Use up to 20 tags.')
  if (p.me !== undefined && typeof p.me !== 'boolean') throw new Error('Choose whether this is you.')
  await mutate((value) => {
    const item = value.items.find((entry) => entry.id === id)
    if (!item) throw new Error('That clip is no longer in your library.')
    if (typeof p.name === 'string') item.name = cleanText(p.name, MAX_NAME_CHARS)
    if (p.tags !== undefined) item.tags = cleanTags(p.tags)
    if (typeof p.me === 'boolean') item.me = p.me
  })
  return libraryView()
}

/** Remove items from the library: their proxies and posters go, and AI shots' own files; originals stay where they are. */
export async function removeLibraryItems(ids: unknown): Promise<BrollLibraryView> {
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_LIBRARY_ITEMS || !ids.every(isLibraryItemId)) throw new Error('Choose clips to remove.')
  const gone = new Set(ids as string[])
  await mutate(async (value) => {
    const removed = value.items.filter((item) => gone.has(item.id))
    value.items = value.items.filter((item) => !gone.has(item.id))
    for (const item of removed) {
      await removeFiles(item)
      if (item.origin === 'ai' && isWithinDirectory(item.original, dirOf('ai'))) await rm(item.original, { force: true }).catch(() => undefined)
    }
  })
  return libraryView()
}

/** A library item's file for another feature (Remix's own b-roll): the original, or the proxy when it's gone. */
export async function libraryItemFiles(ids: unknown): Promise<{ id: string; name: string; path: string; proxy: string | null; kind: 'video' | 'image' }[]> {
  if (!Array.isArray(ids) || !ids.length || ids.length > 50 || !ids.every(isLibraryItemId)) throw new Error('Choose clips from your library.')
  const items = await snapshot()
  return (ids as string[]).map((id) => {
    const item = items.find((entry) => entry.id === id)
    const path = item ? usableFile(item) : null
    if (!item || !path) throw new Error('That clip is no longer in your library.')
    return { id: item.id, name: item.name, path, proxy: proxyFile(item), kind: item.kind }
  })
}

// ---------------------------------------------------------------------------
// Indexing: a vision model looks at a few frames of every shot (paid, the member's OpenRouter key)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You describe b-roll footage so an editor can find the right shot later.
You get a few frames from one shot (in time order). Describe only what is visible. Never guess names, brands or places you cannot read.
If a reference photo of the creator is given first, set member_appears to true only when that same person is clearly in the frames; without a reference photo, set it to false.
Return JSON only.`

async function frameBytes(item: BrollLibraryItem, shot: BrollShotRange, signal: AbortSignal): Promise<Buffer[]> {
  const source = proxyFile(item) ?? originalFile(item)
  if (!source) throw new Error('The file is no longer there.')
  if (item.kind === 'image') {
    const temp = join(app.getPath('temp'), `broll-frame-${randomBytes(6).toString('hex')}.jpg`)
    try {
      await ffmpeg([...IMAGE_INPUT_GUARD, '-i', source, '-frames:v', '1', '-vf', `scale='min(${FRAME_WIDTH},iw)':-2`, '-q:v', '5', temp], 60_000, signal)
      return [await readFile(temp)]
    } finally { await rm(temp, { force: true }).catch(() => undefined) }
  }
  const length = Math.max(0.1, shot.outS - shot.inS)
  const frames: Buffer[] = []
  for (let k = 0; k < FRAMES_PER_SHOT; k++) {
    const at = shot.inS + (length * (k + 1)) / (FRAMES_PER_SHOT + 1)
    const temp = join(app.getPath('temp'), `broll-frame-${randomBytes(6).toString('hex')}.jpg`)
    try {
      await ffmpeg([...VIDEO_INPUT_GUARD, '-ss', at.toFixed(2), '-i', source, '-frames:v', '1', '-vf', `scale='min(${FRAME_WIDTH},iw)':-2`, '-q:v', '5', temp], 60_000, signal)
      if (regularFile(temp)) frames.push(await readFile(temp))
    } catch (error) {
      if (signal.aborted) throw error
    } finally { await rm(temp, { force: true }).catch(() => undefined) }
  }
  if (!frames.length) throw new Error('No frames could be read from this shot.')
  return frames
}

class StopIndexing extends Error {}

/** One look at one shot. Returns the analysis and what OpenRouter charged. */
export async function lookAtShot(frames: Buffer[], reference: Buffer | null, context: { name: string; tags: string[] }, key: string,
  options: { fetch?: typeof fetch; signal?: AbortSignal } = {}): Promise<{ analysis: BrollAnalysis; costUsd: number }> {
  const image = (bytes: Buffer): { type: 'image_url'; image_url: { url: string } } => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${bytes.toString('base64')}` } })
  const hint = [context.name && `File name: ${context.name}`, context.tags.length && `The creator's tags: ${context.tags.join(', ')}`].filter(Boolean).join('\n')
  const content = [
    ...(reference ? [{ type: 'text' as const, text: 'Reference photo of the creator:' }, image(reference)] : []),
    { type: 'text' as const, text: `Frames from one b-roll shot (${frames.length}).${hint ? `\n${hint}` : ''}` },
    ...frames.map(image)
  ]
  let response: Response
  try {
    response = await (options.fetch ?? fetch)(`${openRouterBase()}/chat/completions`, {
      method: 'POST', redirect: 'error', signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://github.com/trentrichards34/bridgeclip', 'X-Title': 'CreatorClips B-roll library' },
      body: JSON.stringify({
        model: BROLL_VISION_MODEL, temperature: 0, max_tokens: 700, usage: { include: true }, provider: { require_parameters: true },
        response_format: { type: 'json_schema', json_schema: { name: 'broll_shot', strict: true, schema: ANALYSIS_SCHEMA } },
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content }]
      })
    })
  } catch (error) {
    if (options.signal?.aborted) throw error
    throw new Error('OpenRouter could not be reached. Check your connection and try again.')
  }
  if (response.status === 401 || response.status === 403) throw new StopIndexing('OpenRouter rejected the API key. Check it in Settings → API keys.')
  if (response.status === 402) throw new StopIndexing('OpenRouter reports insufficient credits. Add credits to your OpenRouter account.')
  if (!response.ok) throw new Error(`OpenRouter couldn’t look at this shot (${response.status}).`)
  const text = await response.text()
  if (text.length > 500_000) throw new Error('OpenRouter returned an unexpected answer.')
  let body: { choices?: { message?: { content?: unknown } }[]; usage?: { cost?: unknown } }
  try { body = JSON.parse(text) } catch { throw new Error('OpenRouter returned an unexpected answer.') }
  reportOpenRouterUsage(BROLL_VISION_MODEL, body)
  const cost = typeof body.usage?.cost === 'number' && Number.isFinite(body.usage.cost) && body.usage.cost > 0 ? body.usage.cost : 0
  return { analysis: parseAnalysis(body.choices?.[0]?.message?.content, BROLL_VISION_MODEL), costUsd: cost }
}

let indexing: { controller: AbortController; done: Promise<BrollIndexProgress> } | null = null

function report(next: BrollIndexProgress): void {
  progress = next
  for (const listener of progressListeners) { try { listener(next) } catch { /* never breaks indexing */ } }
}

/** Shots waiting to be looked at (for the estimate before indexing). */
export async function pendingShotCount(): Promise<number> { return pendingShots(await snapshot()).length }

/**
 * Look at every shot not looked at yet (new and changed items only). One run at a time; progress and the cost so far
 * go to onIndexProgress. The caller runs it inside the spending meter.
 */
export function indexLibrary(options: { fetch?: typeof fetch } = {}): Promise<BrollIndexProgress> {
  if (indexing) return indexing.done
  const controller = new AbortController()
  const done = (async (): Promise<BrollIndexProgress> => {
    const key = loadSettings().openrouterApiKey
    if (!key) throw new Error('Add your OpenRouter key in Settings → API keys first.')
    if (preparing) { report({ phase: 'preparing', done: 0, total: 0, costUsd: 0 }); await preparing }
    const items = await snapshot()
    const todo = pendingShots(items)
    const meItem = items.find((item) => item.me && posterFile(item))
    const reference = meItem ? await readFile(posterFile(meItem) as string).catch(() => null) : null
    let finished = 0, failed = 0, costUsd = 0, stop: string | null = null
    report({ phase: 'looking', done: 0, total: todo.length, costUsd: 0 })
    const work = [...todo]
    const worker = async (): Promise<void> => {
      for (let next = work.shift(); next && !stop && !controller.signal.aborted; next = work.shift()) {
        const { item, shot } = next
        try {
          const frames = await frameBytes(item, shot, controller.signal)
          const look = await lookAtShot(frames, reference, { name: item.name, tags: item.tags }, key, { fetch: options.fetch, signal: controller.signal })
          costUsd += look.costUsd
          await mutate((value) => {
            const target = value.items.find((entry) => entry.id === item.id)?.shots.find((entry) => entry.id === shot.id)
            // Prepared again meanwhile (the file changed): this look is for the old file.
            if (target && target.inS === shot.inS && target.outS === shot.outS) target.analysis = look.analysis
          })
        } catch (error) {
          if (controller.signal.aborted) return
          if (error instanceof StopIndexing) { stop = error.message; return }
          failed++
          logger.warn('broll.index.shot.failed', { message: String((error as Error)?.message ?? error).slice(0, 200) })
        }
        finished++
        report({ phase: 'looking', done: finished, total: todo.length, costUsd })
      }
    }
    await Promise.all(Array.from({ length: Math.min(INDEX_CONCURRENCY, Math.max(1, todo.length)) }, worker))
    const result: BrollIndexProgress = controller.signal.aborted ? { phase: 'cancelled', done: finished, total: todo.length, costUsd, message: 'Stopped. Shots not looked at yet stay in the list.' }
      : stop ? { phase: 'failed', done: finished, total: todo.length, costUsd, message: stop }
        : failed && failed === todo.length ? { phase: 'failed', done: finished, total: todo.length, costUsd, message: 'No shot could be looked at. Try again later.' }
          : { phase: 'done', done: finished, total: todo.length, costUsd, ...(failed ? { message: `${failed} shot${failed === 1 ? '' : 's'} couldn’t be looked at. Try again later.` } : {}) }
    report(result)
    logger.info('broll.indexed', { shots: finished, failed, costUsd })
    return result
  })().finally(() => { indexing = null; changed() })
  indexing = { controller, done }
  return done
}

export function cancelIndexing(): boolean {
  if (!indexing) return false
  indexing.controller.abort()
  return true
}

// ---------------------------------------------------------------------------
// AI shots (Settings → AI b-roll), made from the library page or adopted from a run
// ---------------------------------------------------------------------------

export function brollAiSettings(): BrollAiSettings {
  const settings = loadSettings()
  return parseBrollAiSettings({ kind: settings.brollAiKind, model: settings.brollAiModel, maxShots: Number(settings.brollAiMaxShots) })
}

export function saveBrollAiSettings(value: unknown): BrollAiSettings {
  const checked = checkBrollAiSettings(value)
  saveSettings({ ...loadSettings(), brollAiKind: checked.kind, brollAiModel: checked.model, brollAiMaxShots: String(checked.maxShots) })
  return brollAiSettings()
}

/** A slow push-in on a still, as an MP4 (no sound). */
export async function pushIn(image: string, out: string, seconds = BROLL_AI_IMAGE_SECONDS): Promise<void> {
  const frames = Math.round(seconds * 30)
  await ffmpeg([...IMAGE_INPUT_GUARD, '-i', image, '-filter_complex',
    `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,scale=2160:3840,zoompan=z='min(1+0.0015*on,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=30,format=yuv420p`,
    '-frames:v', String(frames), '-an', ...(await h264Args()), '-movflags', '+faststart', out], 10 * 60_000)
}

/** Make one AI shot from a description and add it to the library (tagged "ai"). The caller meters it. */
export async function makeAiShot(prompt: unknown, options: Pick<MediaOptions, 'fetch' | 'pollMs' | 'assertPublic' | 'signal'> = {}): Promise<BrollLibraryView> {
  const text = cleanText(prompt, 400)
  if (text.length < 3) throw new Error('Describe the shot you want.')
  const key = loadSettings().openrouterApiKey
  if (!key) throw new Error('Add your OpenRouter key in Settings → API keys first.')
  const settings = brollAiSettings()
  await mkdir(dirOf('ai'), { recursive: true, mode: 0o700 })
  const id = randomBytes(6).toString('hex')
  const out = join(dirOf('ai'), `ai-${id}.mp4`)
  const media: MediaOptions = { key, ...options }
  let model: string
  try {
    if (settings.kind === 'image') {
      const request = brollImageRequest(text)
      model = request.model
      const bytes = await generateImage(request, media)
      const still = join(dirOf('ai'), `ai-${id}.png`)
      try { await writeFile(still, bytes); await pushIn(still, out) } finally { await rm(still, { force: true }).catch(() => undefined) }
    } else {
      const request = brollVideoRequest(text, settings)
      model = request.model
      await generateVideo(request, out, media)
    }
  } catch (error) {
    await rm(out, { force: true }).catch(() => undefined)
    throw error
  }
  await addAiFile(out, text, model)
  return libraryView()
}

async function addAiFile(path: string, prompt: string, model: string): Promise<void> {
  const info = statSync(path)
  await mutate((value) => {
    value.items.push({
      id: `l${randomBytes(6).toString('hex')}`, kind: 'video', name: cleanText(prompt, MAX_NAME_CHARS), original: path,
      proxy: null, poster: null, durationS: 0, width: 0, height: 0, size: info.size, mtimeMs: info.mtimeMs,
      addedAt: new Date().toISOString(), origin: 'ai', aiPrompt: cleanText(prompt, 600), aiModel: cleanText(model, 120),
      tags: ['ai'], me: false, shots: [], status: 'new'
    })
  })
  void prepareNewItems()
}

const INCOMING_FILE = /^ai-[0-9a-f]{8,32}\.mp4$/

/** AI shots the engine made during a run: `incoming/ai-<hex>.mp4` with `ai-<hex>.json` ({prompt, model}) written last. */
export async function adoptIncoming(): Promise<number> {
  let names: string[]
  try { names = await readdir(dirOf('incoming')) } catch { return 0 }
  let adopted = 0
  for (const name of names.filter((entry) => INCOMING_FILE.test(entry))) {
    const video = join(dirOf('incoming'), name), sidecar = video.replace(/\.mp4$/, '.json')
    if (!regularFile(video) || !regularFile(sidecar)) continue
    let meta: { prompt?: unknown; model?: unknown } = {}
    try {
      if (statSync(sidecar).size > 20_000) throw new Error('too large')
      meta = JSON.parse(await readFile(sidecar, 'utf8')) as typeof meta
    } catch { await rm(sidecar, { force: true }); continue }
    const prompt = cleanText(meta.prompt, 600)
    await mkdir(dirOf('ai'), { recursive: true, mode: 0o700 })
    const target = join(dirOf('ai'), name)
    try { await rename(video, target) } catch { continue }
    await rm(sidecar, { force: true }).catch(() => undefined)
    await addAiFile(target, prompt || 'AI b-roll shot', cleanText(meta.model, 120))
    adopted++
  }
  return adopted
}

/** Tests: forget what is held in memory. */
export function resetBrollLibraryForTests(): void { index = null; queue = Promise.resolve(); progress = null; indexing = null; preparing = null; encoderArgs = null }
