import type { ZernioPlatform } from './zernio'
import type { ClipMediaInfo, TikTokCreatorInfo, TikTokPostOptions, YouTubeVisibility } from './zernio-posts'

/** TikTok clips require review before the scheduler can publish them. */
export const AUTOMATION_PLATFORMS = ['instagram', 'youtube', 'twitter', 'facebook', 'linkedin', 'threads', 'tiktok'] as const satisfies readonly ZernioPlatform[]

export interface AutomationTikTokApproval {
  caption: string
  options: TikTokPostOptions
  reviewedAt: string
  fileStamp: { size: number; mtimeMs: number; ino: number }
}

export interface AutomationTikTokReview {
  reviewId: string
  clipPath: string
  caption: string
  media: ClipMediaInfo
  creators: { info: TikTokCreatorInfo; businessConnection: boolean; handle: string }[]
}

export interface AutomationTikTokReviewUpdate {
  reviewId: string
  caption: string
  options: TikTokPostOptions
  previewConfirmed: boolean
}

export interface AutomationAccount {
  accountId: string
  platform: (typeof AUTOMATION_PLATFORMS)[number]
}

export type AutomationContentStatus = 'queued' | 'posting' | 'posted' | 'needs_review'

export interface GeneratedPlatformMetadata {
  platform: AutomationAccount['platform']
  caption: string
  /** YouTube, or Facebook when the clip is posted as a Reel. */
  title: string | null
  tags: string[]
  categoryId: string | null
  /** Threads only. Optional so older saved metadata remains readable. */
  topicTag?: string | null
}

export interface AutomationSourceContext {
  /** Opaque library identity for non-YouTube sources. */
  videoId?: string
  title: string
  description: string
  channel: string
  /** Canonical YouTube URL only; local paths and signed source URLs are never sent. */
  url: string | null
}

export interface MetadataResearch {
  scope?: 'source'
  reused?: boolean
  researchedAt?: string
  status: 'complete' | 'unavailable' | 'skipped'
  summary: string
  sources: { title: string; url: string }[]
}

export const MAX_ENHANCEMENT_GUIDANCE = 2000
/** Longest stored research citation URL, measured after URL normalization. */
export const MAX_RESEARCH_URL = 2048

export interface MetadataEnhancement {
  /** User context and editorial direction used to prepare this draft. */
  guidance?: string
  id: string
  createdAt: string
  platforms: AutomationAccount['platform'][]
  posts: GeneratedPlatformMetadata[]
  source: AutomationSourceContext | null
  research: MetadataResearch
}

export interface AutomationContent {
  /** Suppresses existing warning indicators without changing posting eligibility. */
  warningsAcknowledged?: boolean
  /** Dismisses only the current metadata failure; a new failure resets this. */
  metadataErrorAcknowledged?: boolean
  id: string
  /** Original authorized file, retained when a library clip is copied to the bank. */
  sourceClipPath?: string
  /** Changes only after a person reviews an uncertain post and returns the clip to the queue. */
  postingAttemptId?: string
  fileName: string
  title: string
  caption: string
  /** Speech recognized from this exact bank clip; never inferred from its filename. */
  transcript: string | null
  generatedMetadata: GeneratedPlatformMetadata[] | null
  metadataError?: string | null
  sourceContext?: AutomationSourceContext | null
  /** A pending draft holds this clip from posting until applied or discarded. */
  metadataDraft?: MetadataEnhancement | null
  metadataEnhancement?: MetadataEnhancement | null
  /** The exact TikTok caption and choices approved for this clip; absent in older banks. */
  tiktokApproval?: AutomationTikTokApproval | null
  /** Keeps the last reviewed copy when approval is revoked to reopen the editor. */
  tiktokDraftCaption?: string | null
  status: AutomationContentStatus
  addedAt: string
  postedAt: string | null
  postId: string | null
  error: string | null
  /**
   * The upcoming daily slot this clip was handed to Zernio for, as a
   * scheduled post (status 'posted', postedAt null until the slot passes).
   * While set, that slot is covered and the app never posts another clip in it.
   */
  aheadSlot?: AheadSlot | null
}

export interface AheadSlot {
  time: string
  date: string
  /** ISO instant of the slot. */
  at: string
  /** The automation changed or was paused; Zernio's post still has to be cancelled. */
  cancel?: boolean
}

/** Slots handed to Zernio ahead of time: at most this many… */
export const AHEAD_SLOT_COUNT = 3
/** …and none further out than this. Zernio keeps uploads for 7 days. */
export const AHEAD_HORIZON_MS = 48 * 3_600_000
/** Closer slots are left to the app, so a slow upload can't make one late. */
export const AHEAD_MIN_LEAD_MS = 15 * 60_000

export function slotKey(slot: { date: string; time: string }): string {
  return `${slot.date}/${slot.time}`
}

/** A post scheduled with Zernio whose slot hasn't come yet. */
export function isScheduledAhead(item: AutomationContent, now: number): boolean {
  return Boolean(item.aheadSlot && item.status === 'posted' && Date.parse(item.aheadSlot.at) > now)
}

export type UpcomingState = 'zernio' | 'cancelling' | 'app' | 'skipped' | 'uncertain' | 'empty'
export interface UpcomingPost {
  time: string
  date: string
  at: string
  state: UpcomingState
  /** The clip in this slot: scheduled with Zernio, or next in the queue. */
  contentId: string | null
  title: string | null
}

/**
 * What the next few slots will post and who posts them: Zernio (already
 * scheduled, safe to close the app) or CreatorClips (must be open).
 * `slots` comes from upcomingSlots() in schedule-math.ts.
 */
export function upcomingPlan(automation: Pick<Automation, 'accounts' | 'content' | 'skippedSlots'>, slots: { time: string; date: string; at: string }[]): UpcomingPost[] {
  const ready = automation.content.filter((item) => item.status === 'queued' && !item.metadataDraft && !needsTikTokReview(automation, item))
  const queue = [...ready.filter((item) => !item.error), ...ready.filter((item) => item.error)]
  return slots.map((slot) => {
    const ahead = automation.content.find((item) => item.aheadSlot && slotKey(item.aheadSlot) === slotKey(slot))
    if (ahead) {
      const state: UpcomingState = ahead.status === 'needs_review' ? 'uncertain' : ahead.aheadSlot!.cancel ? 'cancelling' : 'zernio'
      return { ...slot, at: ahead.aheadSlot!.at, state, contentId: ahead.id, title: ahead.title }
    }
    if (automation.skippedSlots?.includes(slotKey(slot))) return { ...slot, state: 'skipped' as const, contentId: null, title: null }
    const next = queue.shift()
    return { ...slot, state: next ? 'app' as const : 'empty' as const, contentId: next?.id ?? null, title: next?.title ?? null }
  })
}

export interface AutomationSourceGroup {
  sourceType: 'linked' | 'file'
  key: string
  title: string
  contentIds: string[]
}

export interface AutomationBatchResult {
  automations: Automation[]
  completed: number
  skipped: number
  errors: { contentId: string; message: string }[]
}

export interface AutomationReviewResult {
  automations: Automation[]
  outcome: 'queued' | 'submitted' | 'held'
  message: string
}

export interface Automation {
  sourceResearch?: { key: string; createdAt: string; source: AutomationSourceContext; research: MetadataResearch }[]
  id: string
  name: string
  enabled: boolean
  /** Exactly one Zernio profile owns this automation's selected accounts. */
  profileId: string | null
  /** Automations start with manual captions; AI metadata is opt-in. */
  metadataMode: 'ai' | 'manual'
  accounts: AutomationAccount[]
  /** Daily times in the configured IANA time zone, as HH:mm. */
  times: string[]
  timezone: string
  youtubeVisibility: YouTubeVisibility
  youtubeMadeForKids: boolean
  /** Time -> most recent local YYYY-MM-DD that was attempted. */
  lastSlots: Record<string, string>
  content: AutomationContent[]
  createdAt: string
  lastRunAt: string | null
  lastError: string | null
  lastErrorAcknowledged?: boolean
  /** Hand the next few slots to Zernio as scheduled posts, so they post while the app is closed. Off when unset. */
  scheduleAhead?: boolean
  /** Slots ('YYYY-MM-DD/HH:mm') whose Zernio post was cancelled outside the automation; nothing posts in them. */
  skippedSlots?: string[]
}

export function hasContentWarnings(item: AutomationContent): boolean {
  return !item.warningsAcknowledged && Boolean(item.error || (item.metadataError && !item.metadataErrorAcknowledged) || item.status === 'needs_review')
}

export function hasAutomationWarnings(automation: Automation): boolean {
  return Boolean(automation.lastError && !automation.lastErrorAcknowledged) || automation.content.some(hasContentWarnings)
}

export interface AutomationUpdate {
  name: string
  enabled: boolean
  profileId: string | null
  metadataMode: 'ai' | 'manual'
  accounts: AutomationAccount[]
  times: string[]
  timezone: string
  youtubeVisibility: YouTubeVisibility
  youtubeMadeForKids: boolean
  /** Omitted keeps the current setting. */
  scheduleAhead?: boolean
}

export function needsTikTokReview(automation: Pick<Automation, 'accounts'>, item: AutomationContent): boolean {
  const targets = automation.accounts.filter((account) => account.platform === 'tiktok')
  return targets.length > 0 && (!item.tiktokApproval?.options.consent ||
    targets.some((target) => !item.tiktokApproval?.options.accounts[target.accountId]?.privacyLevel))
}

export function nextAutomationContent(automation: Pick<Automation, 'accounts' | 'content'>): AutomationContent | undefined {
  // A pending enhanced draft holds only its own clip until it is applied or discarded.
  const ready = automation.content.filter((item) => item.status === 'queued' && !item.metadataDraft && !needsTikTokReview(automation, item))
  // A clip whose last attempt failed waits behind clips that have not, so one
  // clip that cannot be prepared (for example, unverifiable AI metadata) does
  // not stop every later slot. It is retried once nothing else is ready.
  return ready.find((item) => !item.error) ?? ready[0]
}

export function canReorderContent(item: AutomationContent): boolean {
  return item.status === 'queued' && !item.postId
}

export function hasEnhancedMetadata(item: AutomationContent, platforms: readonly AutomationAccount['platform'][]): boolean {
  return Boolean(item.metadataEnhancement && platforms.every((platform) => item.generatedMetadata?.some((post) => post.platform === platform)))
}

/** Reorder only queued slots. Submitted and uncertain items retain their positions. */
export function reorderQueuedContent(content: AutomationContent[], id: string, beforeId: string | null): AutomationContent[] {
  const queue = content.filter(canReorderContent)
  const from = queue.findIndex((item) => item.id === id)
  if (from < 0 || (beforeId !== null && !queue.some((item) => item.id === beforeId))) throw new Error('Only unposted queued clips can be reordered. Refresh the queue and try again.')
  if (id === beforeId) return content
  const [item] = queue.splice(from, 1)
  queue.splice(beforeId === null ? queue.length : queue.findIndex((entry) => entry.id === beforeId), 0, item)
  let index = 0
  return content.map((entry) => canReorderContent(entry) ? queue[index++] : entry)
}

/** Return due local slots, including a short grace period after wake/reopen. */
export function dueSlots(times: readonly string[], timezone: string, now: number, graceMinutes = 5): { time: string; date: string }[] {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23'
  })
  const wanted = new Set(times)
  const found = new Set<string>()
  const slots: { time: string; date: string }[] = []
  for (let minutesAgo = graceMinutes - 1; minutesAgo >= 0; minutesAgo--) {
    const parts = Object.fromEntries(formatter.formatToParts(now - minutesAgo * 60_000).map((part) => [part.type, part.value]))
    const time = `${parts.hour}:${parts.minute}`
    const date = `${parts.year}-${parts.month}-${parts.day}`
    const key = `${date}/${time}`
    if (wanted.has(time) && !found.has(key)) { found.add(key); slots.push({ time, date }) }
  }
  return slots
}
