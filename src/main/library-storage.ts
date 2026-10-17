import { app } from 'electron'
import { createHash, randomUUID } from 'crypto'
import { constants, createReadStream, lstatSync, readdirSync, realpathSync, type Dirent, type Stats } from 'fs'
import { copyFile, lstat, mkdir, open, readdir, readFile, realpath, rename, rm, rmdir, stat, statfs, writeFile } from 'fs/promises'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'path'
import { DELETING_RUN_PREFIX, getJobHistory, getJobOutput, type JobHistoryEntry } from './file-manager'
import { editorBusy, freeEditorMedia } from './clip-editor'
import { liveJobIds } from './job-manager'
import { remixFolderInUse, remixRunBusy, remixStatus } from './remix'
import { avatarRenderStatus } from './avatar-studio'
import { withRunLock } from './ctas'
import { libraryPostingSummary } from './library-posting'
import { loadSettings } from './settings-store'
import { logger } from './logger'
import { forgetPreviousFolder, isPreviousOutputFolder, previousOutputFolders, recordMovedRun, rememberPreviousFolder } from './library-folders'
import { editorProgress, parseEditorProject } from '../shared/clip-editor'
import {
  CLEANUP_GROUP_IDS, LOW_DISK_BYTES, isCleanupGroupId, parseCleanupFilters,
  type CleanupFilters, type CleanupGroup, type CleanupGroupId, type CleanupPlan, type CleanupResult, type CleanupSkip,
  type FolderChangeInfo, type FreeSpace, type MoveProgress, type MoveResult, type RunSize
} from '../shared/library-storage'

const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === 'ENOENT'
const sameFolder = (a: string, b: string): boolean => {
  if (resolve(a) === resolve(b)) return true
  try { return realpathSync(a) === realpathSync(b) } catch { return false }
}
const MAX_JSON_BYTES = 32 * 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REMIX_RUN = /^remix-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Avatar Studio keeps its videos in this folder of the output folder. */
const AVATAR_FOLDER = 'Avatar Studio'
const MOVING_PREFIX = '.moving-'

// ---------------------------------------------------------------------------
// Walking a folder without following links
// ---------------------------------------------------------------------------

interface TreeTotals { bytes: number; files: number; unreadable: number }

/** Sum a folder's file sizes, counting a hard-linked file once and never following links. */
async function folderBytes(root: string, maxEntries = 200_000): Promise<TreeTotals> {
  const totals: TreeTotals = { bytes: 0, files: 0, unreadable: 0 }
  const seen = new Set<string>()
  const pending = [root]
  let entries = 0
  while (pending.length) {
    const dir = pending.pop()!
    let names: string[]
    try { names = await readdir(dir) } catch (error) { if (!missing(error)) totals.unreadable++; continue }
    for (const name of names) {
      if (++entries > maxEntries) return totals
      const path = join(dir, name)
      try {
        const info = await lstat(path)
        if (info.isDirectory()) pending.push(path)
        else if (info.isFile()) {
          const key = `${info.dev}:${info.ino}`
          if (seen.has(key)) continue
          seen.add(key)
          totals.bytes += info.size
          totals.files++
        }
      } catch (error) { if (!missing(error)) totals.unreadable++ }
    }
  }
  return totals
}

/** Bytes that deleting this file or folder would actually give back (files with other hard links free nothing). */
async function freeableBytes(path: string, isDir: boolean): Promise<{ bytes: number; files: number }> {
  if (!isDir) {
    const info = await lstat(path)
    return { bytes: info.isFile() && info.nlink <= 1 ? info.size : 0, files: 1 }
  }
  let bytes = 0, files = 0
  const pending = [path]
  while (pending.length) {
    const dir = pending.pop()!
    let names: string[]
    try { names = await readdir(dir) } catch { continue }
    for (const name of names) {
      try {
        const info = await lstat(join(dir, name))
        if (info.isDirectory()) pending.push(join(dir, name))
        else { files++; if (info.isFile() && info.nlink <= 1) bytes += info.size }
      } catch { /* Removed meanwhile. */ }
    }
  }
  return { bytes, files }
}

// ---------------------------------------------------------------------------
// Library roots and run checks
// ---------------------------------------------------------------------------

/** The current output folder first, then earlier ones still shown in the Library. */
export function libraryRoots(): string[] {
  const current = loadSettings().outputDirectory
  return [current, ...previousOutputFolders().filter((dir) => !sameFolder(dir, current))]
}

/** The Library root a run folder sits directly inside, checked without following links. */
function runRoot(raw: unknown, roots = libraryRoots()): string | null {
  if (typeof raw !== 'string' || !isAbsolute(raw) || raw.includes('\0') || raw.length > 4096) return null
  const path = resolve(raw)
  for (const root of roots) {
    if (dirname(path) !== resolve(root)) continue
    try {
      const info = lstatSyncSafe(path)
      if (!info || !info.isDirectory() || info.isSymbolicLink()) return null
      if (dirname(realpathSync(path)) !== realpathSync(root)) return null
      return root
    } catch { return null }
  }
  return null
}

function lstatSyncSafe(path: string): Stats | null {
  try { return lstatSync(path) } catch { return null }
}

/** Why a run can't be changed right now, or null. Reuses every guard the Library uses. */
export function runBusyReason(run: string): string | null {
  if (liveJobIds().has(basename(run))) return 'A job is still running in this run.'
  try { if (editorBusy(run)) return 'The editor is working on this run.' } catch { /* Missing run: checked by the caller. */ }
  const remix = remixStatus()
  const remixFolder = remixFolderInUse()
  if ((remixFolder && sameFolder(remixFolder, run)) ||
      (remix && (remix.phase === 'planning' || remix.phase === 'review' || remix.phase === 'rendering') && remix.folder && sameFolder(remix.folder, run))) return 'A Remix video is being made here.'
  let canonical = run
  try { canonical = realpathSync(run) } catch { /* compared as given */ }
  const busy = remixRunBusy(canonical) ?? remixRunBusy(run)
  if (busy) return 'A Remix video is being re-made here.'
  if (basename(run) === AVATAR_FOLDER) {
    const avatar = avatarRenderStatus()
    if (avatar && !['done', 'failed', 'cancelled'].includes(avatar.phase)) return 'An Avatar Studio video is being made.'
  }
  return null
}

// ---------------------------------------------------------------------------
// Per-run sizes, cached until the run folder changes
// ---------------------------------------------------------------------------

const sizeCache = new Map<string, { signature: string; bytes: number }>()
const sizeInFlight = new Map<string, Promise<number | null>>()

/** Cheap fingerprint of a run: its own and its entries' change times and sizes (one level deep). */
async function runSignature(run: string): Promise<string> {
  const top = await lstat(run)
  const parts = [`${top.dev}:${top.ino}:${top.mtimeMs}`]
  const names = (await readdir(run)).sort()
  for (const name of names) {
    try {
      const info = await lstat(join(run, name))
      parts.push(`${name}:${info.mtimeMs}:${info.size}:${info.ino}`)
      // Remix parts and editor media live one level down; their folder times change with them.
      if (info.isDirectory() && !info.isSymbolicLink()) {
        for (const child of (await readdir(join(run, name))).sort().slice(0, 500)) {
          try { const sub = await lstat(join(run, name, child)); parts.push(`${name}/${child}:${sub.mtimeMs}:${sub.size}`) } catch { /* Removed meanwhile. */ }
        }
      }
    } catch { /* Removed meanwhile. */ }
  }
  return createHash('sha1').update(parts.join('\n')).digest('hex')
}

async function runSize(run: string): Promise<number | null> {
  const active = sizeInFlight.get(run)
  if (active) return active
  const work = (async () => {
    try {
      const signature = await runSignature(run)
      const cached = sizeCache.get(run)
      if (cached?.signature === signature) return cached.bytes
      const { bytes } = await folderBytes(run)
      if (sizeCache.size > 5000) sizeCache.delete(sizeCache.keys().next().value!)
      sizeCache.set(run, { signature, bytes })
      return bytes
    } catch { return null }
  })().finally(() => sizeInFlight.delete(run))
  sizeInFlight.set(run, work)
  return work
}

export function forgetRunSize(run: string): void { sizeCache.delete(resolve(run)) }

/** Sizes of Library runs. Runs are measured a few at a time with async file calls, so the app stays responsive. */
export async function runSizes(outputDirs: unknown): Promise<RunSize[]> {
  if (!Array.isArray(outputDirs) || outputDirs.length > 5000 || !outputDirs.every((dir) => typeof dir === 'string')) throw new Error('Choose runs from your Library.')
  const roots = libraryRoots()
  const dirs = [...new Set(outputDirs as string[])]
  const results: RunSize[] = new Array(dirs.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < dirs.length) {
      const index = next++
      const dir = dirs[index]
      results[index] = { outputDir: dir, bytes: runRoot(dir, roots) ? await runSize(resolve(dir)) : null }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, dirs.length) }, worker))
  return results
}

// ---------------------------------------------------------------------------
// Free up space: what can go, by group
// ---------------------------------------------------------------------------

/** Editor working copies (same names the editor uses). */
const EDITOR_MEDIA = /^editor-(?:source|preview)(?:-[a-f0-9]{32})?\.mp4(?:\.partial\.mp4)?$/
const CTA_ORIGINAL = /^clip_(\d{2,4})\.original\.mp4$/
const REMIX_PART = /^clip_(\d{2,4})$/
/** Names that are never removed, whatever group logic says. */
const PROTECTED = (name: string): boolean =>
  name === 'job_output.json' || name === 'editor-project.json' || name === 'run-history.json' ||
  name.startsWith('.bridgeclip-') || /^clip_\d{2,4}\.mp4$/.test(name) || name.startsWith(DELETING_RUN_PREFIX) || name.startsWith('.delete-clips-')

function leftoverName(name: string, isDir: boolean): boolean {
  if (isDir) return name === '.work' || name === '.recordings' || name === '.reactions'
  return name === '.presenter.jpg' || name === '.voice.mp3' ||
    /^\.cta-[a-f0-9]{8}\.mp4$/.test(name) || /^\.recompose-[a-f0-9]{8}\.mp4$/.test(name) ||
    /^\.editor-[0-9a-f-]{36}\.tmp$/.test(name) || /^\.job_output-[a-f0-9]{8}\.json$/.test(name) ||
    name.endsWith('.tmp')
}

interface PlannedItem {
  group: CleanupGroupId
  path: string
  /** The folder it must still sit in when removed. */
  parent: string
  dev: number
  ino: number
  isDir: boolean
  bytes: number
  files: number
  clipIndex?: number
}

interface RunPlan {
  run: string
  title: string
  dev: number
  ino: number
  editorRevision: number | null
  items: PlannedItem[]
  blocked: Partial<Record<CleanupGroupId, string>>
}

async function readEditorRevision(run: string): Promise<{ revision: number; remaining: number; freed: boolean } | null> {
  const path = join(run, 'editor-project.json')
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(() => null)
  if (!handle) return null
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > MAX_JSON_BYTES) return null
    const project = parseEditorProject(JSON.parse(await handle.readFile('utf8')))
    return { revision: project.revision, remaining: editorProgress(project.candidates).remaining, freed: project.media_freed === true }
  } catch { return null } finally { await handle.close() }
}

async function planRun(run: string, entry: JobHistoryEntry): Promise<RunPlan | null> {
  const top = await lstat(run)
  if (!top.isDirectory() || top.isSymbolicLink()) return null
  const plan: RunPlan = { run, title: entry.videoTitle, dev: top.dev, ino: top.ino, editorRevision: null, items: [], blocked: {} }
  const output = await getJobOutput(run, dirname(run))
  if (!output) return null
  const editor = output.editor_project ? await readEditorRevision(run) : null
  if (editor) plan.editorRevision = editor.revision
  const add = async (group: CleanupGroupId, path: string, parent: string, info: Stats, clipIndex?: number): Promise<void> => {
    const isDir = info.isDirectory()
    const { bytes, files } = await freeableBytes(path, isDir).catch(() => ({ bytes: 0, files: 0 }))
    plan.items.push({ group, path, parent, dev: info.dev, ino: info.ino, isDir, bytes, files, ...(clipIndex === undefined ? {} : { clipIndex }) })
  }
  for (const name of await readdir(run)) {
    if (PROTECTED(name)) continue
    const path = join(run, name)
    let info: Stats
    try { info = await lstat(path) } catch { continue }
    // Never follow or remove links: only real files and folders of this run.
    if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) continue
    if (info.isFile() && EDITOR_MEDIA.test(name)) {
      if (output.editor_project && !editor) { plan.blocked.editorMedia = 'Its editor project could not be read.'; continue }
      if (editor && editor.remaining > 0) { plan.blocked.editorMedia = 'It still has clips to bake or discard in the editor.'; continue }
      await add('editorMedia', path, run, info)
    } else if (info.isFile() && (name === 'framing-source.mp4' || name.endsWith('.partial.mp4'))) {
      await add('intermediates', path, run, info)
    } else if (info.isFile() && CTA_ORIGINAL.test(name)) {
      await add('ctaOriginals', path, run, info, Number(CTA_ORIGINAL.exec(name)![1]))
    } else if (info.isDirectory() && name === '.edit') {
      for (const part of await readdir(path).catch(() => [] as string[])) {
        const partPath = join(path, part)
        const partInfo = await lstat(partPath).catch(() => null)
        if (!partInfo || partInfo.isSymbolicLink() || !partInfo.isDirectory() || !REMIX_PART.test(part)) continue
        await add('remixParts', partPath, path, partInfo, Number(REMIX_PART.exec(part)![1]))
      }
    } else if (leftoverName(name, info.isDirectory())) {
      await add('leftovers', path, run, info)
    }
  }
  return plan
}

interface BuiltPlan { library: string; runs: RunPlan[]; skipped: CleanupSkip[]; runCount: number }

async function buildPlan(filters: CleanupFilters): Promise<BuiltPlan> {
  const library = loadSettings().outputDirectory
  let canonical: string
  try { canonical = await realpath(library) } catch { return { library, runs: [], skipped: [], runCount: 0 } }
  let entries = (await getJobHistory(library, liveJobIds())).filter((entry) => entry.status === 'completed')
  if (filters.olderThanDays !== null) {
    const cutoff = Date.now() - filters.olderThanDays * 86_400_000
    entries = entries.filter((entry) => Date.parse(entry.date) < cutoff)
  }
  if (filters.postedOnly && entries.length) {
    const posted = new Set<string>()
    try {
      for (const result of await libraryPostingSummary(entries.map((entry) => entry.outputDir))) {
        if (result.counts && result.counts.posted > 0 && result.counts.notPosted === 0) posted.add(result.outputDir)
      }
    } catch { /* Posting status unavailable: nothing counts as posted. */ }
    entries = entries.filter((entry) => posted.has(entry.outputDir))
  }
  const runs: RunPlan[] = [], skipped: CleanupSkip[] = []
  for (const entry of entries) {
    const run = entry.outputDir
    try {
      if (dirname(await realpath(run)) !== canonical) continue
      const plan = await planRun(run, entry)
      if (!plan) continue
      const busy = runBusyReason(run)
      if (busy) {
        if (plan.items.length) skipped.push({ outputDir: run, videoTitle: entry.videoTitle, reason: busy })
        continue
      }
      for (const reason of new Set(Object.values(plan.blocked))) skipped.push({ outputDir: run, videoTitle: entry.videoTitle, reason })
      if (plan.items.length) runs.push(plan)
    } catch { /* The run changed while planning: leave it alone. */ }
  }
  return { library, runs, skipped, runCount: entries.length }
}

function summarize(built: BuiltPlan): CleanupPlan {
  const groups: CleanupGroup[] = CLEANUP_GROUP_IDS.map((id) => ({ id, bytes: 0, files: 0, runs: [] }))
  for (const run of built.runs) {
    for (const group of groups) {
      const items = run.items.filter((item) => item.group === group.id)
      if (!items.length) continue
      const bytes = items.reduce((sum, item) => sum + item.bytes, 0)
      const files = items.reduce((sum, item) => sum + item.files, 0)
      group.bytes += bytes
      group.files += files
      group.runs.push({ outputDir: run.run, videoTitle: run.title, bytes, files })
    }
  }
  for (const group of groups) group.runs.sort((a, b) => b.bytes - a.bytes)
  return { groups, skipped: built.skipped, runCount: built.runCount }
}

export async function cleanupPlan(filters: unknown): Promise<CleanupPlan> {
  return summarize(await buildPlan(parseCleanupFilters(filters)))
}

/** The item is still the same real file or folder, in the same place, not a link. */
async function stillPlanned(item: PlannedItem): Promise<boolean> {
  try {
    const info = await lstat(item.path)
    if (info.isSymbolicLink() || info.dev !== item.dev || info.ino !== item.ino || info.isDirectory() !== item.isDir) return false
    return realpathSync(dirname(item.path)) === realpathSync(item.parent)
  } catch { return false }
}

/** Drop `editable` from these clips so the Library stops offering "Edit hook text & captions" (no parts to re-make from). */
async function markNotEditable(run: string, indices: number[]): Promise<void> {
  const file = join(run, 'job_output.json')
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  let raw: Record<string, unknown>
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > MAX_JSON_BYTES) throw new Error('Invalid Library metadata.')
    raw = JSON.parse(await handle.readFile('utf8')) as Record<string, unknown>
  } finally { await handle.close() }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.clips)) throw new Error('Invalid Library metadata.')
  let changed = false
  for (const clip of raw.clips as Record<string, unknown>[]) {
    if (clip && indices.includes(clip.clip_index as number) && 'editable' in clip) { delete clip.editable; changed = true }
  }
  if (!changed) return
  const temp = join(run, `.job_output-${randomUUID().slice(0, 8).replace(/-/g, '')}.json`)
  await writeFile(temp, JSON.stringify(raw), { mode: 0o600, flag: 'wx' })
  try { await rename(temp, file) } catch (error) { await rm(temp, { force: true }); throw error }
}

async function cleanRun(plan: RunPlan, groups: Set<CleanupGroupId>, result: CleanupResult, library: string): Promise<void> {
  const items = plan.items.filter((item) => groups.has(item.group))
  if (!items.length) return
  await withRunLock(plan.run, async () => {
    const top = await lstat(plan.run).catch(() => null)
    if (!top || top.isSymbolicLink() || !top.isDirectory() || top.dev !== plan.dev || top.ino !== plan.ino ||
        dirname(realpathSync(plan.run)) !== realpathSync(library)) {
      result.skipped.push({ outputDir: plan.run, videoTitle: plan.title, reason: 'The run changed. Refresh and try again.' })
      return
    }
    const busy = runBusyReason(plan.run)
    if (busy) { result.skipped.push({ outputDir: plan.run, videoTitle: plan.title, reason: busy }); return }
    const count = (item: PlannedItem): void => {
      const group = result.groups.find((entry) => entry.id === item.group)!
      group.bytes += item.bytes; group.files += item.files
      result.freedBytes += item.bytes; result.removedFiles += item.files
    }
    // Editor media goes through the editor's own "Free editor media" (it records that the media is gone).
    const editorItems = items.filter((item) => item.group === 'editorMedia')
    if (editorItems.length && plan.editorRevision !== null) {
      try {
        await freeEditorMedia(plan.run, plan.editorRevision)
        for (const item of editorItems) if (!(await lstat(item.path).catch(() => null))) count(item)
      } catch (error) {
        result.skipped.push({ outputDir: plan.run, videoTitle: plan.title, reason: `Editor media was kept: ${(error as Error).message}` })
      }
    }
    const remaining = items.filter((item) => item.group !== 'editorMedia' || plan.editorRevision === null)
    // Remix parts: hide "Edit hook text & captions" first, so a half-done removal never offers an edit that can't work.
    const parts = remaining.filter((item) => item.group === 'remixParts' && item.clipIndex !== undefined)
    if (parts.length) {
      try { await markNotEditable(plan.run, parts.map((item) => item.clipIndex!)) } catch {
        result.skipped.push({ outputDir: plan.run, videoTitle: plan.title, reason: 'Its Remix re-edit parts were kept: the run’s details could not be updated.' })
        remaining.splice(0, remaining.length, ...remaining.filter((item) => item.group !== 'remixParts'))
      }
    }
    let failed = 0
    for (const item of remaining) {
      if (!(await stillPlanned(item))) { failed++; continue }
      try {
        // rm never follows links inside a folder: it removes the links themselves.
        await rm(item.path, { recursive: item.isDir, force: false })
        count(item)
      } catch { failed++ }
    }
    if (parts.length) await rmdir(join(plan.run, '.edit')).catch(() => undefined)
    if (failed) result.skipped.push({ outputDir: plan.run, videoTitle: plan.title, reason: `${failed} item${failed === 1 ? '' : 's'} changed or could not be removed.` })
  })
  forgetRunSize(plan.run)
}

/** Remove the chosen groups. The plan is rebuilt here; nothing the renderer names is trusted. */
export async function runCleanup(groupIds: unknown, filters: unknown): Promise<CleanupResult> {
  if (!Array.isArray(groupIds) || !groupIds.length || groupIds.length > CLEANUP_GROUP_IDS.length || !groupIds.every(isCleanupGroupId)) throw new Error('Choose what to remove.')
  const built = await buildPlan(parseCleanupFilters(filters))
  const groups = new Set(groupIds as CleanupGroupId[])
  const result: CleanupResult = { freedBytes: 0, removedFiles: 0, groups: [...groups].map((id) => ({ id, bytes: 0, files: 0 })), skipped: [...built.skipped] }
  for (const plan of built.runs) {
    try { await cleanRun(plan, groups, result, built.library) } catch (error) {
      result.skipped.push({ outputDir: plan.run, videoTitle: plan.title, reason: (error as Error).message || 'Could not clean this run.' })
    }
  }
  logger.info('storage.cleanup', { groups: [...groups], freedBytes: result.freedBytes, files: result.removedFiles, skipped: result.skipped.length })
  return result
}

// ---------------------------------------------------------------------------
// Free space on the output drive
// ---------------------------------------------------------------------------

export async function freeSpace(): Promise<FreeSpace> {
  const outputDirectory = loadSettings().outputDirectory
  let dir = resolve(outputDirectory)
  // The folder may not exist yet: check the drive it will be created on.
  for (let i = 0; i < 64; i++) {
    try {
      const info = await statfs(dir)
      const freeBytes = Number(info.bavail) * Number(info.bsize)
      return { outputDirectory, freeBytes, low: freeBytes < LOW_DISK_BYTES, thresholdBytes: LOW_DISK_BYTES }
    } catch {
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  return { outputDirectory, freeBytes: null, low: false, thresholdBytes: LOW_DISK_BYTES }
}

// ---------------------------------------------------------------------------
// Output folder changes: earlier folders stay in the Library, or move
// ---------------------------------------------------------------------------

/** Folders CreatorClips made in an output folder (runs, Remix runs, Avatar Studio). */
function libraryFolderNames(root: string): string[] {
  let entries: Dirent[]
  try { entries = readdirSync(root, { withFileTypes: true }) } catch { return [] }
  return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') &&
    (UUID.test(entry.name) || REMIX_RUN.test(entry.name) || entry.name === AVATAR_FOLDER || hasJobOutput(join(root, entry.name))))
    .map((entry) => entry.name)
}

function hasJobOutput(run: string): boolean {
  const info = lstatSyncSafe(join(run, 'job_output.json'))
  return Boolean(info?.isFile() && !info.isSymbolicLink())
}

export function folderChangeInfo(): FolderChangeInfo {
  const outputDirectory = loadSettings().outputDirectory
  return { outputDirectory, runCount: libraryFolderNames(outputDirectory).length }
}

/** Called after the output folder setting changed: the old folder's runs stay reachable. */
export function onOutputFolderChanged(previous: string, next: string): void {
  if (sameFolder(previous, next)) return
  try {
    if (libraryFolderNames(previous).length) rememberPreviousFolder(previous)
    forgetPreviousFolder(next)
  } catch (error) { logger.warn('storage.previousFolder.saveFailed', { message: String((error as Error)?.message ?? error).slice(0, 200) }) }
}

export interface PreviousFolderListing { folder: string; exists: boolean; runs: JobHistoryEntry[]; otherFolders: number }

export async function listPreviousFolders(): Promise<PreviousFolderListing[]> {
  const current = loadSettings().outputDirectory
  const listings: PreviousFolderListing[] = []
  for (const folder of previousOutputFolders()) {
    if (sameFolder(folder, current)) continue
    let exists = false
    try { exists = (await stat(folder)).isDirectory() } catch { /* Missing or unplugged drive. */ }
    const runs = exists ? (await getJobHistory(folder, liveJobIds()).catch(() => [])).filter((entry) => entry.status === 'completed') : []
    const listed = new Set(runs.map((entry) => basename(entry.outputDir)))
    listings.push({ folder, exists, runs, otherFolders: exists ? libraryFolderNames(folder).filter((name) => !listed.has(name)).length : 0 })
  }
  return listings
}

export function forgetFolder(folder: unknown): void {
  if (typeof folder !== 'string' || !isPreviousOutputFolder(folder)) throw new Error('Choose an earlier output folder from the Library.')
  forgetPreviousFolder(folder)
}

// Moves in progress are written down first, so a crash or quit mid-move is finished (or undone) at the next start.
interface MoveJournalEntry { source: string; staging: string; dest: string; mode: 'rename' | 'copy' }

function journalPath(): string { return join(app.getPath('userData'), 'library-moves.json') }

async function readJournal(): Promise<MoveJournalEntry[]> {
  try {
    const items = JSON.parse(await readFile(journalPath(), 'utf8')) as MoveJournalEntry[]
    return Array.isArray(items) ? items.filter((item) => item && typeof item.source === 'string' && typeof item.staging === 'string' &&
      typeof item.dest === 'string' && (item.mode === 'rename' || item.mode === 'copy') && basename(item.staging).startsWith(MOVING_PREFIX)) : []
  } catch { return [] }
}

async function writeJournal(items: MoveJournalEntry[]): Promise<void> {
  const path = journalPath()
  if (!items.length) { await rm(path, { force: true }); return }
  const temp = `${path}.${randomUUID()}.tmp`
  await writeFile(temp, JSON.stringify(items), { mode: 0o600 })
  await rename(temp, path)
}

let journalQueue: Promise<unknown> = Promise.resolve()
function updateJournal(change: (items: MoveJournalEntry[]) => MoveJournalEntry[]): Promise<void> {
  const next = journalQueue.catch(() => undefined).then(async () => writeJournal(change(await readJournal())))
  journalQueue = next
  return next
}

/** Rewrite saved absolute paths (clip files, sources) from the old run folder to the new one. */
async function rewriteRunPaths(root: string, from: string[], to: string): Promise<void> {
  const prefixes = [...new Set(from.map((path) => resolve(path)))].sort((a, b) => b.length - a.length)
  const map = (value: string): string => {
    const scheme = value.startsWith('file://') ? 'file://' : ''
    const body = scheme ? value.slice(scheme.length) : value
    for (const prefix of prefixes) {
      if (body === prefix || body.startsWith(`${prefix}${sep}`) || (sep === '\\' && body.startsWith(`${prefix}/`))) return scheme + to + body.slice(prefix.length)
    }
    return value
  }
  const visit = (value: unknown): [unknown, boolean] => {
    if (typeof value === 'string') { const next = map(value); return [next, next !== value] }
    if (Array.isArray(value)) {
      let changed = false
      const next = value.map((item) => { const [mapped, did] = visit(item); changed ||= did; return mapped })
      return [next, changed]
    }
    if (value && typeof value === 'object') {
      let changed = false
      const next: Record<string, unknown> = {}
      for (const [key, item] of Object.entries(value)) { const [mapped, did] = visit(item); changed ||= did; next[key] = mapped }
      return [next, changed]
    }
    return [value, false]
  }
  const pending: [string, number][] = [[root, 0]]
  while (pending.length) {
    const [dir, depth] = pending.pop()!
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      const path = join(dir, name)
      const info = await lstat(path).catch(() => null)
      if (!info || info.isSymbolicLink()) continue
      if (info.isDirectory()) { if (depth < 4) pending.push([path, depth + 1]); continue }
      if (!info.isFile() || !name.endsWith('.json') || info.size > MAX_JSON_BYTES) continue
      let data: unknown
      try { data = JSON.parse(await readFile(path, 'utf8')) } catch { continue }
      const [next, changed] = visit(data)
      if (!changed) continue
      const temp = join(dir, `.${name}.${randomUUID().slice(0, 8)}.tmp`)
      await writeFile(temp, JSON.stringify(next), { mode: info.mode & 0o777 })
      await rename(temp, path)
    }
  }
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/** Every regular file (relative path → size) under a folder; links and other entries are not part of a run's data. */
async function treeFiles(root: string): Promise<{ files: Map<string, number>; dirs: string[]; links: number }> {
  const files = new Map<string, number>(), dirs: string[] = []
  let links = 0
  const pending = ['']
  while (pending.length) {
    const rel = pending.pop()!
    for (const name of await readdir(join(root, rel))) {
      const child = rel ? join(rel, name) : name
      const info = await lstat(join(root, child))
      if (info.isSymbolicLink()) links++
      else if (info.isDirectory()) { dirs.push(child); pending.push(child) } else if (info.isFile()) files.set(child, info.size)
    }
  }
  return { files, dirs, links }
}

async function copyVerified(source: string, staging: string, onBytes: (bytes: number) => void): Promise<void> {
  const tree = await treeFiles(source)
  await mkdir(staging, { mode: 0o700 })
  for (const dir of tree.dirs.sort((a, b) => a.length - b.length)) await mkdir(join(staging, dir))
  for (const [rel, size] of tree.files) {
    await copyFile(join(source, rel), join(staging, rel), constants.COPYFILE_EXCL)
    onBytes(size)
  }
  // Verify: the same files, the same sizes and the same bytes.
  const copied = await treeFiles(staging)
  if (copied.files.size !== tree.files.size) throw new Error('The copy is incomplete.')
  for (const [rel, size] of tree.files) {
    if (copied.files.get(rel) !== size) throw new Error('The copy is incomplete.')
    if (await sha256(join(source, rel)) !== await sha256(join(staging, rel))) throw new Error('The copy does not match the original.')
  }
}

/** Finish or undo moves interrupted by a crash or quit. Safe to run at every start. */
export async function recoverInterruptedMoves(): Promise<void> {
  const items = await readJournal()
  if (!items.length) return
  for (const item of items) {
    try {
      const staged = await lstat(item.staging).catch(() => null)
      const dest = await lstat(item.dest).catch(() => null)
      if (item.mode === 'rename') {
        // The run was renamed into the staging folder: finish moving it in.
        if (staged?.isDirectory() && !staged.isSymbolicLink() && !dest) {
          await rewriteRunPaths(item.staging, [item.source], item.dest)
          await rename(item.staging, item.dest)
          recordMovedRun(item.source, item.dest)
        }
      } else if (dest?.isDirectory() && !dest.isSymbolicLink()) {
        // The verified copy is in place: remove the original if it is still there.
        const original = await lstat(item.source).catch(() => null)
        if (original?.isDirectory() && !original.isSymbolicLink()) await rm(item.source, { recursive: true })
        recordMovedRun(item.source, item.dest)
      } else if (staged?.isDirectory() && !staged.isSymbolicLink()) {
        // An unfinished copy: the original is untouched, drop the copy.
        await rm(item.staging, { recursive: true })
      }
    } catch (error) {
      logger.warn('storage.move.recoverFailed', { message: String((error as Error)?.message ?? error).slice(0, 200) })
      continue
    }
    await updateJournal((current) => current.filter((entry) => entry.staging !== item.staging))
  }
}

let moving = false

/** Move every run from an earlier output folder into the current one. Busy runs are skipped and reported. */
export async function moveFolderRuns(folder: unknown, onProgress: (progress: MoveProgress) => void = () => undefined): Promise<MoveResult> {
  if (typeof folder !== 'string' || !isPreviousOutputFolder(folder)) throw new Error('Choose an earlier output folder from the Library.')
  if (moving) throw new Error('Runs are already being moved. Wait for that to finish.')
  moving = true
  try {
    await recoverInterruptedMoves()
    const source = resolve(folder)
    const target = loadSettings().outputDirectory
    if (sameFolder(source, target)) { forgetPreviousFolder(source); return { moved: 0, skipped: [], remaining: 0 } }
    const sourceInfo = await stat(source).catch(() => null)
    if (!sourceInfo?.isDirectory()) throw new Error('This folder is not available. Connect its drive, then try again.')
    await mkdir(target, { recursive: true })
    const targetReal = await realpath(target)
    const titles = new Map((await getJobHistory(source, liveJobIds()).catch(() => [])).map((entry) => [basename(entry.outputDir), entry.videoTitle]))
    const names = libraryFolderNames(source)
    const skipped: CleanupSkip[] = []
    const todo: string[] = []
    for (const name of names) {
      const run = join(source, name)
      const title = titles.get(name) ?? name
      const busy = runBusyReason(run)
      if (busy) { skipped.push({ outputDir: run, videoTitle: title, reason: busy }); continue }
      if (await lstat(join(target, name)).catch(() => null)) {
        skipped.push({ outputDir: run, videoTitle: title, reason: 'A folder with the same name is already in your current output folder.' })
        continue
      }
      todo.push(name)
    }
    const sizes = new Map<string, number>()
    for (const name of todo) sizes.set(name, (await folderBytes(join(source, name))).bytes)
    const progress: MoveProgress = { folder: source, done: 0, total: todo.length, bytesDone: 0, bytesTotal: [...sizes.values()].reduce((a, b) => a + b, 0), current: null }
    onProgress({ ...progress })
    let moved = 0
    for (const name of todo) {
      const run = join(source, name)
      const title = titles.get(name) ?? name
      progress.current = title
      onProgress({ ...progress })
      const before = progress.bytesDone
      try {
        await withRunLock(run, () => moveRun(run, targetReal, name, (bytes) => {
          progress.bytesDone += bytes
          onProgress({ ...progress })
        }))
        moved++
      } catch (error) {
        skipped.push({ outputDir: run, videoTitle: title, reason: (error as Error).message || 'Could not move this run.' })
      }
      progress.bytesDone = before + (sizes.get(name) ?? 0)
      progress.done++
      onProgress({ ...progress, current: null })
    }
    const remaining = libraryFolderNames(source).length
    if (!remaining) forgetPreviousFolder(source)
    logger.info('storage.move', { moved, skipped: skipped.length, remaining })
    return { moved, skipped, remaining }
  } finally { moving = false }
}

async function moveRun(run: string, targetRoot: string, name: string, onBytes: (bytes: number) => void): Promise<void> {
  const original = await lstat(run)
  if (!original.isDirectory() || original.isSymbolicLink()) throw new Error('This run is not a real folder, so it was left where it is.')
  const busy = runBusyReason(run)
  if (busy) throw new Error(busy)
  const dest = join(targetRoot, name)
  const staging = join(targetRoot, `${MOVING_PREFIX}${randomUUID()}`)
  const fromPaths = [run, realpathSync(run)]
  const targetInfo = await stat(targetRoot)
  if (targetInfo.dev === original.dev) {
    await updateJournal((items) => [...items, { source: run, staging, dest, mode: 'rename' }])
    try {
      // Same drive: an instant rename into a hidden folder, then the saved paths are updated and it appears.
      await rename(run, staging)
    } catch (error) {
      await updateJournal((items) => items.filter((item) => item.staging !== staging))
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw new Error('This run could not be moved. Close any app using its files, then try again.')
      return copyRun(run, dest, staging, fromPaths, onBytes)
    }
    try {
      await rewriteRunPaths(staging, fromPaths, dest)
      await rename(staging, dest)
    } catch {
      // Put it back as it was (the original paths are still right there).
      await rename(staging, run).catch(() => undefined)
      await rewriteRunPaths(run, [dest], run).catch(() => undefined)
      await updateJournal((items) => items.filter((item) => item.staging !== staging))
      throw new Error('This run could not be moved. It was left where it is.')
    }
    await updateJournal((items) => items.filter((item) => item.staging !== staging))
    recordMovedRun(run, dest)
    onBytes(0)
    return
  }
  return copyRun(run, dest, staging, fromPaths, onBytes)
}

async function copyRun(run: string, dest: string, staging: string, fromPaths: string[], onBytes: (bytes: number) => void): Promise<void> {
  const identity = await lstat(run)
  await updateJournal((items) => [...items, { source: run, staging, dest, mode: 'copy' }])
  try {
    await copyVerified(run, staging, onBytes)
    await rewriteRunPaths(staging, fromPaths, dest)
    await rename(staging, dest)
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    await updateJournal((items) => items.filter((item) => item.staging !== staging))
    const disk = (error as NodeJS.ErrnoException).code === 'ENOSPC'
    throw new Error(disk ? 'There is not enough space in the new folder. Free up space there, then try again.' : `This run could not be copied (${(error as Error).message.replace(/\s*\(.*$/, '').slice(0, 120)}). It was left where it is.`)
  }
  recordMovedRun(run, dest)
  // The copy is verified and in place: remove the original (only if it is still the same real folder).
  const now = await lstat(run).catch(() => null)
  if (now && now.isDirectory() && !now.isSymbolicLink() && now.dev === identity.dev && now.ino === identity.ino) {
    try { await rm(run, { recursive: true }) } catch { logger.warn('storage.move.sourceKept', { message: 'A moved run’s original folder could not be fully removed.' }) }
  }
  await updateJournal((items) => items.filter((item) => item.staging !== staging))
}
