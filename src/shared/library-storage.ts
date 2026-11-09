/**
 * Disk space for the Library: per-run sizes, the "Free up space" plan, moving
 * runs between output folders, and the low-disk warning before a new run.
 */

/** What "Free up space" can remove. Finished clips, results and posting history are never in a group. */
export type CleanupGroupId = 'editorMedia' | 'intermediates' | 'leftovers' | 'remixParts' | 'ctaOriginals'

export const CLEANUP_GROUP_IDS: readonly CleanupGroupId[] = ['editorMedia', 'intermediates', 'leftovers', 'remixParts', 'ctaOriginals']

export function isCleanupGroupId(value: unknown): value is CleanupGroupId {
  return typeof value === 'string' && (CLEANUP_GROUP_IDS as readonly string[]).includes(value)
}

export interface CleanupFilters {
  /** Only runs older than this many days; null for any age. */
  olderThanDays: number | null
  /** Only runs whose every clip is posted. */
  postedOnly: boolean
}

export const DEFAULT_CLEANUP_FILTERS: CleanupFilters = { olderThanDays: null, postedOnly: false }

export function parseCleanupFilters(value: unknown): CleanupFilters {
  const raw = (value ?? {}) as Record<string, unknown>
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Choose valid filters.')
  const days = raw.olderThanDays ?? null
  if (days !== null && (typeof days !== 'number' || !Number.isSafeInteger(days) || days < 1 || days > 3650)) throw new Error('Choose a number of days between 1 and 3650.')
  if (raw.postedOnly !== undefined && typeof raw.postedOnly !== 'boolean') throw new Error('Choose valid filters.')
  return { olderThanDays: days as number | null, postedOnly: raw.postedOnly === true }
}

export interface CleanupRunItem {
  outputDir: string
  videoTitle: string
  bytes: number
  files: number
}

export interface CleanupGroup {
  id: CleanupGroupId
  bytes: number
  files: number
  runs: CleanupRunItem[]
}

export interface CleanupSkip {
  outputDir: string
  videoTitle: string
  reason: string
}

export interface CleanupPlan {
  groups: CleanupGroup[]
  /** Runs with something to remove that are left alone right now, and why. */
  skipped: CleanupSkip[]
  /** Runs that matched the filters. */
  runCount: number
}

export interface CleanupResult {
  freedBytes: number
  removedFiles: number
  groups: { id: CleanupGroupId; bytes: number; files: number }[]
  skipped: CleanupSkip[]
}

export interface RunSize {
  outputDir: string
  /** null when the run folder could not be read. */
  bytes: number | null
}

/** Below this much free space, starting a new run asks first. */
export const LOW_DISK_BYTES = 2_000_000_000

export interface FreeSpace {
  outputDirectory: string
  /** null when the drive could not be checked. */
  freeBytes: number | null
  low: boolean
  thresholdBytes: number
}

export interface FolderChangeInfo {
  outputDirectory: string
  /** Library runs (and other CreatorClips folders) in the current output folder. */
  runCount: number
}

export interface MoveProgress {
  folder: string
  done: number
  total: number
  bytesDone: number
  bytesTotal: number
  current: string | null
}

export interface MoveResult {
  moved: number
  skipped: CleanupSkip[]
  /** Runs still in the earlier folder after the move. */
  remaining: number
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const unit = bytes > 0 ? Math.min(Math.floor(Math.log10(bytes) / 3), units.length - 1) : 0
  return `${(bytes / 1000 ** unit).toLocaleString('en-US', { maximumFractionDigits: unit === 0 ? 0 : 1 })} ${units[unit]}`
}
