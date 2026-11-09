/**
 * HeyGen (Beta): realistic, lip-synced talking avatars on the member's own
 * HeyGen API key. Shared by the main process and the renderer.
 *
 * Everything here follows HeyGen's v3 API docs (developers.heygen.com, read
 * on the date in HEYGEN_PRICES.checkedOn): POST /v3/assets, POST /v3/avatars
 * (types "photo" and "digital_twin"), POST /v3/avatars/{group_id}/consent,
 * GET /v3/avatars/looks/{look_id}, GET /v3/avatars/{group_id},
 * GET /v3/avatars/looks?ownership=public, POST /v3/videos, GET /v3/videos/{id}
 * and GET /v3/users/me, with the key in the x-api-key header.
 */

/**
 * HeyGen's published pay-as-you-go API prices, copied from the pricing page
 * on `checkedOn`. These only drive estimates (and the ledger's estimated
 * entries); HeyGen's own bill is what counts. The API reports no cost.
 */
export const HEYGEN_PRICES = {
  checkedOn: '2026-10-19',
  source: 'https://developers.heygen.com/docs/pricing',
  /** Avatar video, Engine IV: public avatars, digital twins and photo avatars alike. USD per second of output. */
  avatarIvPerSecond: 0.1,
  /** Creating a digital twin or a photo avatar. USD per call. */
  avatarCreation: 1
} as const

/** The engine HeyGen uses when a video request names none (Avatar IV), the one the price above is for. */
export const HEYGEN_DEFAULT_ENGINE = 'avatar_iv'
export const HEYGEN_ENGINES = ['avatar_iv', 'avatar_v', 'avatar_iii'] as const

/** Footage for a digital twin (seconds). HeyGen accepts 15-600 and suggests about 2 minutes; we cap at 3 so the upload stays under 32 MB at good quality. */
export const TWIN_MIN_SECONDS = 15
export const TWIN_MAX_SECONDS = 180
/** POST /v3/assets takes files up to 32 MB. */
export const HEYGEN_MAX_ASSET_BYTES = 32 * 1024 * 1024
/** Avatar audio input: at most 10 minutes. */
export const HEYGEN_MAX_AUDIO_SECONDS = 600
/** A consent link works for 24 hours. */
export const CONSENT_LINK_MS = 24 * 60 * 60_000

export type HeygenSource = 'twin' | 'photo' | 'stock'
export type HeygenStatus = 'processing' | 'pending_consent' | 'completed' | 'failed'
export type HeygenConsent = 'pending' | 'accepted' | 'rejected' | null
/** heygen: HeyGen speaks the script in a HeyGen voice (the twin's clone or a stock voice); app: lip-sync to the avatar's own app voice. */
export type HeygenVoiceChoice = 'heygen' | 'app'

/** What an avatar keeps about its HeyGen counterpart (in avatar.json, never the key). */
export interface HeygenAvatarLink {
  provider: 'heygen'
  source: HeygenSource
  /** The look id: HeyGen's avatar_id for videos. */
  lookId: string
  /** The avatar group (HeyGen's "character"); consent acts on it. Null for stock avatars. */
  groupId: string | null
  status: HeygenStatus
  consentStatus: HeygenConsent
  /** HeyGen's consent page for this avatar, and when it was made (links work for 24 hours). */
  consentUrl: string | null
  consentUrlAt: string | null
  /** A HeyGen voice for this avatar: the clone made from twin footage, or a stock avatar's own voice. */
  voiceId: string | null
  voice: HeygenVoiceChoice
  /** Engines the look renders on (supported_api_engines), when HeyGen said. */
  engines: string[]
  /** HeyGen's own reason when training or consent failed, in its words. */
  error: string | null
  checkedAt: string | null
}

const HEYGEN_ID = /^[A-Za-z0-9_.:-]{1,128}$/

/** HeyGen ids (looks, groups, voices, videos, assets) are opaque; we only accept a safe shape and URL-encode them. */
export function isHeygenId(value: unknown): value is string {
  return typeof value === 'string' && HEYGEN_ID.test(value)
}

const STATUSES: readonly string[] = ['processing', 'pending_consent', 'completed', 'failed']

export function parseHeygenStatus(value: unknown, fallback: HeygenStatus = 'processing'): HeygenStatus {
  return typeof value === 'string' && STATUSES.includes(value) ? value as HeygenStatus : fallback
}

/** consent_status from HeyGen. The docs list pending, accepted and rejected (and null for photo and prompt groups). */
export function parseConsent(value: unknown): HeygenConsent {
  if (value === 'accepted' || value === 'rejected') return value
  if (value === 'pending' || value === 'pending_consent') return 'pending'
  return null
}

/** Control characters as spaces (names and titles from HeyGen or the member). */
export function withoutControls(value: string): string {
  return Array.from(value, (char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? ' ' : char)).join('')
}

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() ? withoutControls(value).replace(/\s+/g, ' ').trim().slice(0, max) : null
}

function iso(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) ? new Date(Date.parse(value)).toISOString() : null
}

/** A stored link, or null when there is none or it is unreadable. */
export function parseHeygenLink(value: unknown): HeygenAvatarLink | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (raw.provider !== 'heygen' || !isHeygenId(raw.lookId)) return null
  if (raw.source !== 'twin' && raw.source !== 'photo' && raw.source !== 'stock') return null
  const consentUrl = typeof raw.consentUrl === 'string' && /^https?:\/\//.test(raw.consentUrl) && raw.consentUrl.length <= 2048 ? raw.consentUrl : null
  return {
    provider: 'heygen', source: raw.source, lookId: raw.lookId,
    groupId: isHeygenId(raw.groupId) ? raw.groupId : null,
    status: parseHeygenStatus(raw.status),
    consentStatus: parseConsent(raw.consentStatus),
    consentUrl, consentUrlAt: consentUrl ? iso(raw.consentUrlAt) : null,
    voiceId: isHeygenId(raw.voiceId) ? raw.voiceId : null,
    voice: raw.voice === 'heygen' && isHeygenId(raw.voiceId) ? 'heygen' : 'app',
    engines: Array.isArray(raw.engines) ? raw.engines.filter((engine): engine is string => typeof engine === 'string' && /^[a-z_]{1,30}$/.test(engine)).slice(0, 8) : [],
    error: text(raw.error, 300),
    checkedAt: iso(raw.checkedAt)
  }
}

/** True while a consent link is still usable. */
export function consentLinkFresh(link: Pick<HeygenAvatarLink, 'consentUrl' | 'consentUrlAt'>, now = Date.now()): boolean {
  return Boolean(link.consentUrl && link.consentUrlAt && now - Date.parse(link.consentUrlAt) < CONSENT_LINK_MS - 5 * 60_000)
}

/** The step a HeyGen avatar is at, as the member sees it. */
export type HeygenStage = 'training' | 'consent' | 'consent-rejected' | 'failed' | 'ready'

/**
 * Digital twins need the person's consent (recorded on HeyGen's page) before
 * they can make videos; photo and stock avatars have no consent step. HeyGen's
 * "pending" covers both "not recorded yet" and "under review".
 */
export function heygenStage(link: Pick<HeygenAvatarLink, 'source' | 'status' | 'consentStatus'>): HeygenStage {
  if (link.consentStatus === 'rejected') return 'consent-rejected'
  if (link.status === 'failed') return 'failed'
  if ((link.source === 'twin' && link.consentStatus !== 'accepted') || link.status === 'pending_consent') return 'consent'
  if (link.status === 'processing') return 'training'
  return 'ready'
}

/** The engine to ask for: HeyGen's default unless this look doesn't list it. */
export function heygenEngine(engines: readonly string[]): string | null {
  if (!engines.length || engines.includes(HEYGEN_DEFAULT_ENGINE)) return null
  return HEYGEN_ENGINES.find((engine) => engines.includes(engine)) ?? null
}

/**
 * The estimated HeyGen cost of `seconds` of avatar video, from the published
 * Engine IV price. Null when another engine renders it (no published price we
 * keep), so the app says "billed by HeyGen" without a number.
 */
export function estimateHeygenVideoUsd(seconds: number, engine: string | null = null): number | null {
  if ((engine ?? HEYGEN_DEFAULT_ENGINE) !== HEYGEN_DEFAULT_ENGINE || !Number.isFinite(seconds) || seconds <= 0) return null
  return Math.round(seconds * HEYGEN_PRICES.avatarIvPerSecond * 100) / 100
}

/** "Oct 19, 2026" for the price note. */
export function pricesCheckedOn(): string {
  const [year, month, day] = HEYGEN_PRICES.checkedOn.split('-').map(Number)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[month - 1]} ${day}, ${year}`
}

/** What GET /v3/users/me says about the account, reduced to what Settings shows. */
export interface HeygenAccount {
  name: string | null
  /** wallet, subscription or usage_based (HeyGen's billing_type). */
  billingType: string | null
  /** What is left, in plain words, or null when HeyGen didn't say. */
  remaining: string | null
  checkedAt: string
}

function amount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function count(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}

/** Plain words for the balance in a /v3/users/me response (data object). */
export function heygenRemaining(data: unknown): string | null {
  const raw = (data ?? {}) as Record<string, unknown>
  const wallet = raw.wallet as Record<string, unknown> | null | undefined
  const subscription = raw.subscription as Record<string, unknown> | null | undefined
  const usage = raw.usage_based as Record<string, unknown> | null | undefined
  if (raw.billing_type === 'wallet' || (wallet && !subscription && !usage)) {
    const balance = amount(wallet?.remaining_balance)
    if (balance === null) return null
    return wallet?.currency === 'credits' ? `${count(balance)} credits left` : `$${balance.toFixed(2)} left in your HeyGen wallet`
  }
  if (raw.billing_type === 'subscription' || (subscription && !usage)) {
    const credits = (subscription?.credits ?? {}) as Record<string, { remaining?: unknown } | null>
    const premium = amount(credits.premium_credits?.remaining)
    const addOn = amount(credits.add_on_credits?.remaining)
    const parts = [premium !== null ? `${count(premium)} premium credits` : null, addOn !== null ? `${count(addOn)} add-on credits` : null].filter(Boolean)
    const plan = typeof subscription?.plan === 'string' ? subscription.plan.replace(/_/g, ' ') : null
    if (!parts.length) return plan ? `${plan} plan` : null
    return `${parts.join(' and ')} left${plan ? ` (${plan} plan)` : ''}`
  }
  if (raw.billing_type === 'usage_based' || usage) {
    const credits = amount(usage?.remaining_credits)
    if (credits !== null) return `${count(credits)} credits left`
    const spent = amount(usage?.spending_current_usd), cap = amount(usage?.spending_cap_usd)
    if (spent !== null && cap !== null) return `$${spent.toFixed(2)} of your $${cap.toFixed(2)} cap used`
    if (spent !== null) return `$${spent.toFixed(2)} used this period`
  }
  return null
}

export function parseHeygenAccount(data: unknown, now = new Date()): HeygenAccount {
  const raw = (data ?? {}) as Record<string, unknown>
  const name = [text(raw.first_name, 60), text(raw.last_name, 60)].filter(Boolean).join(' ') || text(raw.username, 80)
  return { name, billingType: text(raw.billing_type, 30), remaining: heygenRemaining(raw), checkedAt: now.toISOString() }
}

/** A HeyGen stock avatar to pick from (its preview saved locally for the page). */
export interface HeygenStockAvatar {
  lookId: string
  name: string
  gender: string | null
  /** Local, authorized preview picture, or null when it could not be fetched. */
  previewPath: string | null
  voiceId: string | null
}

/** What the renderer asks for when making a HeyGen avatar. */
export interface HeygenCreateInput {
  source: HeygenSource
  name: string
  /** twin: a recorded or chosen video draft; photo: a photo draft. */
  draftId?: string
  /** stock: the look to use. */
  lookId?: string
  /** The member confirmed they are the person (twin and photo). */
  consent: boolean
  /** The avatar's app voice (used when HeyGen has no voice for it, or the member picks it). */
  voice: unknown
  /** twin and stock: speak in HeyGen's voice for this avatar (default) or the app voice. */
  useHeygenVoice?: boolean
}

/** A recorded or chosen twin video, ready to preview before it is sent to HeyGen. */
export interface HeygenVideoDraft {
  draftId: string
  /** A still from the video (authorized for the page). */
  path: string
  /** The prepared MP4 (authorized for the page). */
  videoPath: string
  seconds: number
}
