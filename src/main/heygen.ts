import { app } from 'electron'
import { randomUUID } from 'crypto'
import { createWriteStream } from 'fs'
import { rename, rm } from 'fs/promises'
import { isHeygenId, withoutControls } from '../shared/heygen'
import { readResponseText } from './http-response'
import { logger } from './logger'
import { assertPublicWebUrl } from './network-policy'

/**
 * A small client for HeyGen's v3 API, called only from the main process with
 * the member's own key (x-api-key header, as the docs describe). Every call
 * has a time limit; a 429 rate limit is waited out using Retry-After; the key
 * is never logged or put in an error message.
 *
 * Docs (read 2026-10-19):
 *   https://developers.heygen.com/docs/quick-start            (base URL, x-api-key, 429 + Retry-After)
 *   https://developers.heygen.com/reference/get-current-user   (GET /v3/users/me)
 *   https://developers.heygen.com/reference/upload-asset       (POST /v3/assets, multipart "file", 32 MB)
 *   https://developers.heygen.com/reference/create-avatar      (POST /v3/avatars: photo | digital_twin)
 *   https://developers.heygen.com/reference/get-avatar-look    (GET /v3/avatars/looks/{look_id})
 *   https://developers.heygen.com/reference/get-avatar-group   (GET /v3/avatars/{group_id})
 *   https://developers.heygen.com/reference/list-avatar-looks  (GET /v3/avatars/looks?ownership=public)
 *   https://developers.heygen.com/reference/create-avatar-consent (POST /v3/avatars/{group_id}/consent)
 *   https://developers.heygen.com/reference/create-video       (POST /v3/videos)
 *   https://developers.heygen.com/reference/get-video          (GET /v3/videos/{video_id})
 *   https://developers.heygen.com/docs/error-codes
 */

const API_BASE = 'https://api.heygen.com'
const JSON_TIMEOUT_MS = 30_000
const UPLOAD_TIMEOUT_MS = 5 * 60_000
const MAX_RETRIES = 3
const MAX_RETRY_WAIT_MS = 60_000

/** The API base. End-to-end builds (unpackaged, with the env var set) point it at a local stand-in. */
export function heygenBase(): string {
  const override = !app.isPackaged ? process.env.BRIDGECLIP_E2E_HEYGEN_URL : undefined
  return override && /^http:\/\/127\.0\.0\.1:\d+$/.test(override) ? override : API_BASE
}

export class HeygenError extends Error {
  constructor(message: string, readonly code: string | null = null, readonly status = 0) { super(message) }
}

/** Codes that mean the account can't pay for the request. */
const CREDIT_CODES = new Set(['insufficient_credit', 'trial_limit_exceeded', 'subscription_required', 'usage_limit_reached', 'quota_exceeded'])

export const HEYGEN_OUT_OF_CREDIT = 'Your HeyGen balance is too low for this. Add credit on HeyGen, then try again.'

/** A fixed, plain message for a HeyGen error code; HeyGen's own wording is added only where it helps and is cleaned first. */
export function heygenMessage(status: number, code: string | null, detail: string | null): string {
  if (status === 401 || code === 'unauthorized' || code === 'api_key_owner_workspace_access_revoked') return 'HeyGen rejected the API key. Check it in Settings → API keys.'
  if (code && CREDIT_CODES.has(code)) return code === 'usage_limit_reached' ? 'Your HeyGen workspace hit a usage limit set by its admin. Ask them to raise it, or wait for it to reset.' : HEYGEN_OUT_OF_CREDIT
  if (status === 402) return HEYGEN_OUT_OF_CREDIT
  if (code === 'avatar_consent_required') return 'HeyGen needs your consent recording before this avatar can make videos. Open the consent page from the avatar in Avatar Studio.'
  if (code === 'resource_not_ready') return 'HeyGen is still preparing this avatar. Try again in a few minutes.'
  if (code === 'avatar_not_usable' || code === 'content_policy_violation') return `HeyGen's content check turned this down.${detail ? ` HeyGen says: ${detail}` : ''} Try a different photo, video or script.`
  if (code === 'avatar_expired') return 'This HeyGen avatar expired because your workspace ran out of avatar slots. Free a slot on HeyGen, then try again.'
  if (code === 'resolution_not_allowed' || code === 'plan_upgrade_required') return 'Your HeyGen plan doesn’t allow this (1080p vertical video). Check your plan on HeyGen.'
  if (code === 'insufficient_api_key_scope' || code === 'api_key_required' || code === 'api_endpoint_disabled') return 'This HeyGen key can’t use this feature. Create a key with full API access on HeyGen.'
  if (code === 'phone_verification_required') return 'HeyGen asks you to verify your phone number first. Do that on HeyGen, then try again.'
  if (code === 'avatar_not_found' || code === 'video_not_found' || status === 404) return 'HeyGen no longer has this item. It may have been deleted on HeyGen.'
  if (status === 429) return 'HeyGen is busy (rate limit). Try again in a minute.'
  if (status >= 500) return `HeyGen had a problem (${status}). Try again shortly.`
  return `HeyGen could not do that${code ? ` (${code})` : status ? ` (${status})` : ''}.${detail ? ` HeyGen says: ${detail}` : ''}`
}

/** Printable text only, short, and never the key. */
export function cleanDetail(value: unknown, key: string): string | null {
  if (typeof value !== 'string') return null
  let text = value.replace(/[^\x20-\x7E]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (key) text = text.split(key).join('[key]')
  text = text.replace(/https?:\/\/\S+/g, '[link]')
  return text ? text.slice(0, 200) : null
}

export interface HeygenOptions {
  key: string
  signal?: AbortSignal
  fetch?: typeof fetch
  /** Waits between retries (tests make it instant). */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, ms)
    const onAbort = (): void => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function limit(signal: AbortSignal | undefined, ms: number): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms)
}

/** How long a 429 asks us to wait: Retry-After seconds (or an HTTP date), else a short backoff. */
export function retryAfterMs(header: string | null, attempt: number, now = Date.now()): number {
  const fallback = Math.min(MAX_RETRY_WAIT_MS, 1000 * 2 ** attempt)
  if (!header) return fallback
  const seconds = Number(header.trim())
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(MAX_RETRY_WAIT_MS, Math.max(250, seconds * 1000))
  const date = Date.parse(header)
  return Number.isFinite(date) ? Math.min(MAX_RETRY_WAIT_MS, Math.max(250, date - now)) : fallback
}

/** A sanitized path for logs: ids replaced. */
function logPath(path: string): string {
  return path.replace(/\?.*$/, '').split('/').map((part, index) => index > 2 && part ? ':id' : part).join('/')
}

interface RequestSpec {
  method: 'GET' | 'POST'
  path: string
  json?: unknown
  form?: FormData
  /** Sent on creating calls so a retry never makes a second avatar or video. */
  idempotencyKey?: string
  timeoutMs?: number
}

/**
 * One API call returning the parsed JSON body. 429s are retried after
 * Retry-After (quota_exceeded is not: waiting won't help). Network failures
 * are retried only for reads and idempotent creates.
 */
export async function heygenRequest(spec: RequestSpec, options: HeygenOptions): Promise<Record<string, unknown>> {
  if (!options.key) throw new HeygenError('Add your HeyGen key in Settings → API keys first.')
  const doFetch = options.fetch ?? fetch
  const wait = options.sleep ?? sleep
  const url = `${heygenBase()}${spec.path}`
  const retryNetwork = spec.method === 'GET' || Boolean(spec.idempotencyKey)
  for (let attempt = 0; ; attempt++) {
    const headers: Record<string, string> = { 'x-api-key': options.key, Accept: 'application/json' }
    if (spec.json !== undefined) headers['Content-Type'] = 'application/json'
    if (spec.idempotencyKey) headers['Idempotency-Key'] = spec.idempotencyKey
    let response: Response
    try {
      response = await doFetch(url, {
        method: spec.method, headers, redirect: 'error', signal: limit(options.signal, spec.timeoutMs ?? JSON_TIMEOUT_MS),
        body: spec.form ?? (spec.json !== undefined ? JSON.stringify(spec.json) : undefined)
      })
    } catch (error) {
      if (options.signal?.aborted) throw error
      if (retryNetwork && attempt < MAX_RETRIES) { await wait(1000 * 2 ** attempt, options.signal); continue }
      logger.warn('heygen.unreachable', { method: spec.method, path: logPath(spec.path) })
      throw new HeygenError('HeyGen could not be reached. Check your connection and try again.')
    }
    let body: Record<string, unknown> = {}
    let raw = ''
    try { raw = await readResponseText(response, 2_000_000, 'HeyGen returned too much data.') } catch (error) {
      if (options.signal?.aborted) throw error
    }
    try { const parsed: unknown = raw ? JSON.parse(raw) : {}; if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Record<string, unknown> } catch { /* not JSON */ }
    if (response.ok) return body
    const error = (body.error && typeof body.error === 'object' ? body.error : {}) as Record<string, unknown>
    const code = typeof error.code === 'string' && /^[a-z0-9_]{1,60}$/.test(error.code) ? error.code : null
    logger.warn('heygen.error', { method: spec.method, path: logPath(spec.path), status: response.status, code })
    if (response.status === 429 && code !== 'quota_exceeded' && attempt < MAX_RETRIES) {
      await wait(retryAfterMs(response.headers.get('retry-after'), attempt), options.signal)
      continue
    }
    if (spec.method === 'GET' && response.status >= 500 && attempt < MAX_RETRIES) { await wait(1000 * 2 ** attempt, options.signal); continue }
    throw new HeygenError(heygenMessage(response.status, code, cleanDetail(error.message, options.key)), code, response.status)
  }
}

function data(body: Record<string, unknown>): Record<string, unknown> {
  const value = body.data
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HeygenError('HeyGen returned an unexpected response.')
  return value as Record<string, unknown>
}

function id(path: string): string {
  if (!isHeygenId(path)) throw new HeygenError('HeyGen returned an unexpected id.')
  return encodeURIComponent(path)
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/** GET /v3/users/me: confirms the key and reports the balance. */
export async function getCurrentUser(options: HeygenOptions): Promise<Record<string, unknown>> {
  return data(await heygenRequest({ method: 'GET', path: '/v3/users/me' }, options))
}

/** POST /v3/assets (multipart, one "file" field, up to 32 MB). Returns the asset id. */
export async function uploadAsset(bytes: Uint8Array, fileName: string, mime: string, options: HeygenOptions): Promise<{ assetId: string; url: string | null }> {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), fileName)
  const result = data(await heygenRequest({ method: 'POST', path: '/v3/assets', form, idempotencyKey: randomUUID(), timeoutMs: UPLOAD_TIMEOUT_MS }, options))
  if (!isHeygenId(result.asset_id)) throw new HeygenError('HeyGen did not accept the upload.')
  return { assetId: result.asset_id, url: typeof result.url === 'string' ? result.url : null }
}

export interface LookInfo {
  id: string
  name: string
  avatarType: string | null
  groupId: string | null
  status: string | null
  defaultVoiceId: string | null
  engines: string[]
  previewImageUrl: string | null
  gender: string | null
  error: string | null
}

export interface GroupInfo {
  id: string
  status: string | null
  consentStatus: string | null
  defaultVoiceId: string | null
  error: string | null
}

function str(value: unknown): string | null { return typeof value === 'string' && value ? value : null }

function errorText(value: unknown, key: string): string | null {
  const raw = (value ?? null) as { message?: unknown } | null
  return raw ? cleanDetail(raw.message, key) : null
}

export function parseLook(value: unknown, key = ''): LookInfo {
  const raw = (value ?? {}) as Record<string, unknown>
  if (!isHeygenId(raw.id)) throw new HeygenError('HeyGen returned an avatar without an id.')
  return {
    id: raw.id, name: typeof raw.name === 'string' ? raw.name.slice(0, 80) : 'HeyGen avatar', avatarType: str(raw.avatar_type),
    groupId: isHeygenId(raw.group_id) ? raw.group_id : null, status: str(raw.status), defaultVoiceId: isHeygenId(raw.default_voice_id) ? raw.default_voice_id : null,
    engines: Array.isArray(raw.supported_api_engines) ? raw.supported_api_engines.filter((engine): engine is string => typeof engine === 'string') : [],
    previewImageUrl: str(raw.preview_image_url), gender: str(raw.gender), error: errorText(raw.error, key)
  }
}

export function parseGroup(value: unknown, key = ''): GroupInfo {
  const raw = (value ?? {}) as Record<string, unknown>
  if (!isHeygenId(raw.id)) throw new HeygenError('HeyGen returned an avatar group without an id.')
  return { id: raw.id, status: str(raw.status), consentStatus: str(raw.consent_status), defaultVoiceId: isHeygenId(raw.default_voice_id) ? raw.default_voice_id : null, error: errorText(raw.error, key) }
}

/** POST /v3/avatars with an uploaded asset: a photo avatar or a digital twin (which also clones a voice from the footage). */
export async function createAvatar(type: 'photo' | 'digital_twin', name: string, assetId: string, options: HeygenOptions): Promise<{ look: LookInfo; group: GroupInfo | null }> {
  if (!isHeygenId(assetId)) throw new HeygenError('The upload to HeyGen failed.')
  const result = data(await heygenRequest({
    method: 'POST', path: '/v3/avatars', idempotencyKey: randomUUID(),
    json: { type, name: name.slice(0, 60), file: { type: 'asset_id', asset_id: assetId } }
  }, options))
  const look = parseLook(result.avatar_item, options.key)
  const group = result.avatar_group ? parseGroup(result.avatar_group, options.key) : null
  return { look: { ...look, groupId: look.groupId ?? group?.id ?? null }, group }
}

/** GET /v3/avatars/looks/{look_id}: training status of one look. */
export async function getLook(lookId: string, options: HeygenOptions): Promise<LookInfo> {
  return parseLook(data(await heygenRequest({ method: 'GET', path: `/v3/avatars/looks/${id(lookId)}` }, options)), options.key)
}

/** GET /v3/avatars/{group_id}: the group's status and consent status. */
export async function getGroup(groupId: string, options: HeygenOptions): Promise<GroupInfo> {
  return parseGroup(data(await heygenRequest({ method: 'GET', path: `/v3/avatars/${id(groupId)}` }, options)), options.key)
}

/** GET /v3/avatars/looks?ownership=public: HeyGen's preset (stock) avatars. */
export async function listPublicLooks(options: HeygenOptions & { limit?: number; token?: string | null }): Promise<{ looks: LookInfo[]; nextToken: string | null }> {
  const query = new URLSearchParams({ ownership: 'public', limit: String(Math.max(1, Math.min(50, options.limit ?? 24))) })
  if (options.token && /^[A-Za-z0-9_=.:-]{1,512}$/.test(options.token)) query.set('token', options.token)
  const body = await heygenRequest({ method: 'GET', path: `/v3/avatars/looks?${query}` }, options)
  const list = Array.isArray(body.data) ? body.data : []
  const looks: LookInfo[] = []
  for (const item of list) { try { looks.push(parseLook(item, options.key)) } catch { /* skip */ } }
  return { looks, nextToken: body.has_more === true && typeof body.next_token === 'string' ? body.next_token : null }
}

/**
 * POST /v3/avatars/{group_id}/consent: HeyGen's consent page link for the
 * person in a digital twin. They open it and record a short statement on
 * camera; HeyGen reviews it. The link works for 24 hours.
 */
export async function createConsent(groupId: string, options: HeygenOptions): Promise<{ url: string; group: GroupInfo | null }> {
  const result = data(await heygenRequest({ method: 'POST', path: `/v3/avatars/${id(groupId)}/consent`, json: {}, idempotencyKey: randomUUID() }, options))
  const url = typeof result.url === 'string' ? result.url : ''
  if (!isConsentUrl(url)) throw new HeygenError('HeyGen did not return a consent link. Try again.')
  let group: GroupInfo | null = null
  try { group = result.avatar_group ? parseGroup(result.avatar_group, options.key) : null } catch { group = null }
  return { url, group }
}

/** Consent links open in the member's browser: https only (or the end-to-end stand-in). */
export function isConsentUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.username || url.password) return false
    if (url.protocol === 'https:') return true
    return heygenBase() !== API_BASE && url.origin === new URL(heygenBase()).origin
  } catch { return false }
}

export interface VideoInput {
  avatarId: string
  /** Either HeyGen speaks this script in voiceId... */
  script?: string
  voiceId?: string | null
  /** ...or the avatar lip-syncs to this uploaded audio. */
  audioAssetId?: string
  /** null: HeyGen's default engine (Avatar IV). */
  engine?: string | null
  title?: string
}

/**
 * POST /v3/videos: a vertical 1080p avatar video. The v3 API has no
 * "dimension" field; aspect_ratio 9:16 at resolution 1080p is 1080x1920.
 */
export function videoBody(input: VideoInput): Record<string, unknown> {
  if (!isHeygenId(input.avatarId)) throw new HeygenError('Choose a HeyGen avatar.')
  const body: Record<string, unknown> = { type: 'avatar', avatar_id: input.avatarId, aspect_ratio: '9:16', resolution: '1080p', fit: 'cover', output_format: 'mp4' }
  if (input.audioAssetId) {
    if (!isHeygenId(input.audioAssetId)) throw new HeygenError('The voiceover upload to HeyGen failed.')
    body.audio_asset_id = input.audioAssetId
  } else {
    const script = (input.script ?? '').trim()
    if (!script) throw new HeygenError('Write a script first.')
    if (script.length > 5000) throw new HeygenError('HeyGen reads at most 5,000 characters. Shorten the script.')
    body.script = script
    if (input.voiceId) {
      if (!isHeygenId(input.voiceId)) throw new HeygenError('Choose a voice for this avatar.')
      body.voice_id = input.voiceId
    }
  }
  if (input.engine) body.engine = { type: input.engine }
  if (input.title) body.title = withoutControls(input.title).slice(0, 80)
  return body
}

export async function createVideo(input: VideoInput, options: HeygenOptions): Promise<{ videoId: string }> {
  const result = data(await heygenRequest({ method: 'POST', path: '/v3/videos', json: videoBody(input), idempotencyKey: randomUUID() }, options))
  if (!isHeygenId(result.video_id)) throw new HeygenError('HeyGen did not start the video.')
  return { videoId: result.video_id }
}

export interface VideoInfo {
  id: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'waiting'
  videoUrl: string | null
  duration: number | null
  failureCode: string | null
  failureMessage: string | null
}

/** GET /v3/videos/{video_id}. */
export async function getVideo(videoId: string, options: HeygenOptions): Promise<VideoInfo> {
  const raw = data(await heygenRequest({ method: 'GET', path: `/v3/videos/${id(videoId)}` }, options))
  const status = raw.status === 'completed' || raw.status === 'failed' || raw.status === 'processing' || raw.status === 'pending' ? raw.status : 'waiting'
  return {
    id: videoId, status, videoUrl: str(raw.video_url), duration: typeof raw.duration === 'number' && Number.isFinite(raw.duration) ? raw.duration : null,
    failureCode: typeof raw.failure_code === 'string' ? raw.failure_code.slice(0, 60) : null, failureMessage: cleanDetail(raw.failure_message, options.key)
  }
}

// ---------------------------------------------------------------------------
// Downloads (presigned file links: no key is sent)
// ---------------------------------------------------------------------------

/** A file link HeyGen returned may be fetched only over https to a public address (or from the end-to-end stand-in). */
export async function assertDownloadUrl(value: string): Promise<void> {
  let url: URL
  try { url = new URL(value) } catch { throw new HeygenError('HeyGen returned a bad file link.') }
  if (url.username || url.password) throw new HeygenError('HeyGen returned a bad file link.')
  if (heygenBase() !== API_BASE && url.origin === new URL(heygenBase()).origin) return
  if (url.protocol !== 'https:') throw new HeygenError('HeyGen returned a file link that isn’t secure.')
  try { await assertPublicWebUrl(value) } catch { throw new HeygenError('HeyGen returned a file link to an unexpected place.') }
}

/**
 * Stream a HeyGen file (a finished video, a preview image) to `destination`,
 * capped at `maxBytes`. Each redirect is checked again. The finished video is
 * already paid for, so a dropped transfer is retried twice.
 */
export async function downloadHeygenFile(url: string, destination: string, options: { signal?: AbortSignal; fetch?: typeof fetch; maxBytes?: number; retries?: number; sleep?: HeygenOptions['sleep'] } = {}): Promise<number> {
  const retries = options.retries ?? 2
  for (let attempt = 0; ; attempt++) {
    try { return await downloadOnce(url, destination, options) }
    catch (error) {
      if (options.signal?.aborted || attempt >= retries || (error instanceof HeygenError && /link|too large|redirect/.test(error.message))) throw error
      await (options.sleep ?? sleep)(2000 * (attempt + 1), options.signal)
    }
  }
}

async function downloadOnce(url: string, destination: string, options: { signal?: AbortSignal; fetch?: typeof fetch; maxBytes?: number }): Promise<number> {
  const doFetch = options.fetch ?? fetch
  const maxBytes = options.maxBytes ?? 1_000_000_000
  let current = url
  let response: Response | null = null
  for (let hop = 0; hop < 5; hop++) {
    await assertDownloadUrl(current)
    const headerLimit = new AbortController()
    const timer = setTimeout(() => headerLimit.abort(new DOMException('Timed out', 'TimeoutError')), 60_000)
    try { response = await doFetch(current, { redirect: 'manual', signal: options.signal ? AbortSignal.any([options.signal, headerLimit.signal]) : headerLimit.signal }) }
    finally { clearTimeout(timer) }
    if (response.status < 300 || response.status >= 400) break
    const location = response.headers.get('location')
    await response.body?.cancel().catch(() => undefined)
    if (!location) throw new HeygenError('Downloading from HeyGen failed (bad redirect).')
    current = new URL(location, current).toString()
    response = null
  }
  if (!response) throw new HeygenError('Downloading from HeyGen failed (too many redirects).')
  if (!response.ok || !response.body) throw new HeygenError(`Downloading from HeyGen failed (${response.status}).`)
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) { await response.body.cancel().catch(() => undefined); throw new HeygenError('The file from HeyGen is too large.') }
  const partial = `${destination}.part`
  const out = createWriteStream(partial, { flags: 'w', mode: 0o600 })
  const reader = response.body.getReader()
  let size = 0
  try {
    for (;;) {
      const chunk = reader.read()
      let stall: ReturnType<typeof setTimeout> | undefined
      const timer = new Promise<never>((_, reject) => { stall = setTimeout(() => reject(new HeygenError('The download from HeyGen stalled. Try again.')), 60_000) })
      let next: ReadableStreamReadResult<Uint8Array>
      try { next = await Promise.race([chunk, timer]) } finally { clearTimeout(stall) }
      if (next.done) break
      size += next.value.byteLength
      if (size > maxBytes) throw new HeygenError('The file from HeyGen is too large.')
      if (!out.write(next.value)) await new Promise<void>((resolve) => out.once('drain', () => resolve()))
    }
    await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => error ? reject(error) : resolve()))
    await rename(partial, destination)
    return size
  } catch (error) {
    out.destroy()
    await reader.cancel().catch(() => undefined)
    await rm(partial, { force: true })
    throw error
  }
}
