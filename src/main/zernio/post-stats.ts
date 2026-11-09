// Turning Zernio's GET /v1/analytics?postId= answer into the stats kept with a
// post, and deciding which posts are worth asking about. Pure: no Electron or
// network, so tests can cover every branch.
//
// Response shape: AnalyticsSinglePostResponse in Zernio's API reference
// (`analytics` roll-up, `platformAnalytics[]` per account, `syncStatus`,
// `message`, and `analytics.lastUpdated`).

import { sanitizeProviderText } from './client'
import { isZernioId } from '../../shared/zernio'
import {
  POST_METRIC_KEYS,
  type PostMetrics,
  type PostRecord,
  type PostStats,
  type PostTargetStats,
  type StatsSyncStatus
} from '../../shared/zernio-posts'

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {}
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e13 ? Math.round(value) : null
}

function iso(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null
}

const SYNC: StatsSyncStatus[] = ['synced', 'pending', 'partial', 'unavailable']
function syncStatus(value: unknown, fallback: StatsSyncStatus): StatsSyncStatus {
  return SYNC.includes(value as StatsSyncStatus) ? (value as StatsSyncStatus) : fallback
}

/** Null when Zernio sent no counts at all, so "no data" never shows as zeros. */
export function parseMetrics(value: unknown): PostMetrics | null {
  const raw = asRecord(value)
  const metrics = Object.fromEntries(POST_METRIC_KEYS.map((key) => [key, count(raw[key])])) as unknown as PostMetrics
  return POST_METRIC_KEYS.some((key) => metrics[key] !== null) ? metrics : null
}

function accountIdOf(value: unknown): string | null {
  if (isZernioId(value)) return value
  const record = asRecord(value)
  const id = record._id ?? record.id
  return isZernioId(id) ? id : null
}

/**
 * Stats from one analytics answer. `httpStatus` 202 means Zernio is still
 * syncing; 424 means every platform failed. A metric Zernio leaves out stays
 * null. Only targets this post was made to are kept.
 */
export function parsePostAnalytics(body: unknown, httpStatus: number, record: Pick<PostRecord, 'targets'>, now: string): PostStats {
  const raw = asRecord(body)
  const fallback: StatsSyncStatus = httpStatus === 202 ? 'pending' : httpStatus === 424 ? 'unavailable' : 'synced'
  const entries = Array.isArray(raw.platformAnalytics) ? raw.platformAnalytics.slice(0, 50).map(asRecord) : []
  const targets: PostTargetStats[] = []
  for (const target of record.targets) {
    const sameNetwork = record.targets.filter((t) => t.platform === target.platform).length
    const entry = entries.find((e) => accountIdOf(e.accountId) === target.accountId && (!e.platform || e.platform === target.platform)) ??
      (sameNetwork === 1 ? entries.find((e) => !accountIdOf(e.accountId) && e.platform === target.platform) : undefined)
    if (!entry) continue
    const metrics = parseMetrics(entry.analytics)
    targets.push({
      platform: target.platform,
      accountId: target.accountId,
      syncStatus: syncStatus(entry.syncStatus, metrics ? 'synced' : fallback === 'synced' ? 'pending' : fallback),
      metrics,
      message: sanitizeProviderText(entry.errorMessage, 200) ?? null
    })
  }
  const total = parseMetrics(raw.analytics)
  const updatedAt = iso(asRecord(raw.analytics).lastUpdated)
  return {
    fetchedAt: now,
    updatedAt,
    syncStatus: syncStatus(raw.syncStatus, total ? fallback : fallback === 'synced' ? 'pending' : fallback),
    total,
    targets,
    message: sanitizeProviderText(raw.message, 200) ?? null
  }
}

/**
 * Keep the last real numbers when a newer answer has none (a pending sync
 * after a token refresh, say), so a post never drops back to "no stats".
 */
export function mergePostStats(previous: PostStats | null | undefined, next: PostStats): PostStats {
  if (!previous) return next
  const targets = next.targets.map((target) => {
    if (target.metrics) return target
    const old = previous.targets.find((t) => t.platform === target.platform && t.accountId === target.accountId)
    return old?.metrics ? { ...target, metrics: old.metrics } : target
  })
  for (const old of previous.targets) {
    if (old.metrics && !targets.some((t) => t.platform === old.platform && t.accountId === old.accountId)) targets.push(old)
  }
  return { ...next, total: next.total ?? previous.total, updatedAt: next.updatedAt ?? previous.updatedAt, targets }
}

/** How often one post may be asked about. Zernio syncs metrics from the platforms periodically. */
export const STATS_MIN_GAP_MS = 30 * 60_000
/** A refresh the person asked for may ask again sooner. */
export const STATS_FORCED_GAP_MS = 5 * 60_000
/** While Zernio says the numbers are still syncing. */
export const STATS_PENDING_GAP_MS = 10 * 60_000
/** Zernio's analytics range is at most 366 days. */
export const STATS_MAX_AGE_MS = 365 * 86_400_000
/** Posts asked about per refresh; analytics share a stricter per-second window. */
export const STATS_BATCH = 8
export const STATS_REQUEST_GAP_MS = 1_100

/** Whether `post` can have stats and hasn't been asked about too recently. */
export function statsDue(post: PostRecord, now: number, force: boolean): boolean {
  if (post.status !== 'published' && post.status !== 'partial') return false
  if (!post.targets.some((target) => target.status === 'published' && !target.inbox)) return false
  if (now - Date.parse(post.createdAt) > STATS_MAX_AGE_MS) return false
  const stats = post.stats
  if (!stats) return true
  const last = Date.parse(stats.fetchedAt)
  if (!Number.isFinite(last) || last > now) return true
  const gap = force ? STATS_FORCED_GAP_MS : stats.syncStatus === 'pending' ? STATS_PENDING_GAP_MS : STATS_MIN_GAP_MS
  return now - last >= gap
}

/** Never-fetched first, then the longest since the last fetch; newest posts break ties. */
export function statsOrder(a: PostRecord, b: PostRecord): number {
  const at = (post: PostRecord): number => post.stats ? Date.parse(post.stats.fetchedAt) || 0 : -1
  return at(a) - at(b) || b.createdAt.localeCompare(a.createdAt)
}

/**
 * The `fromDate` analytics needs: a day before the post was made (it publishes
 * then or later), as YYYY-MM-DD in UTC, so time zones can't push it past.
 */
export function statsFromDate(post: Pick<PostRecord, 'createdAt'>): string {
  return new Date(Date.parse(post.createdAt) - 86_400_000).toISOString().slice(0, 10)
}
