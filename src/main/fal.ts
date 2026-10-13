import { createWriteStream } from 'fs'
import { rename, rm } from 'fs/promises'
import { readResponseText } from './http-response'

/**
 * Minimal client for fal.ai's queue REST API, called from the main process
 * with the user's own key. Requests are submitted, polled and fetched through
 * the URLs fal returns (never rebuilt locally), and cancelled on abort.
 */

const QUEUE_BASE = 'https://queue.fal.run/'
const STORAGE_INITIATE = 'https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3'
/** Hosts fal serves generated files from. Results are only downloaded from these. */
const RESULT_HOSTS = ['fal.media', 'fal.run', 'fal.ai', 'storage.googleapis.com']

export interface FalOptions {
  key: string
  signal?: AbortSignal
  /** Called with a short status while waiting, e.g. "In queue (position 3)". */
  onStatus?: (status: string) => void
  /** Overall limit for one request, including time in fal's queue. */
  timeoutMs?: number
  pollMs?: number
  fetch?: typeof fetch
}

export class FalError extends Error {}

/** The caller's abort signal (if any) combined with a time limit for one network step. */
export function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms)
}

/** True only for a cancel the user asked for, not a step timing out. */
function userAborted(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted) && (error as Error)?.name === 'AbortError'
}

function headers(key: string, json = true): Record<string, string> {
  return { Authorization: `Key ${key}`, ...(json ? { 'Content-Type': 'application/json' } : {}) }
}

/** A fixed, user-facing message for a failed fal call. Never echoes the key. */
export async function falFailure(response: Response, model: string): Promise<FalError> {
  let detail = ''
  try { detail = await readResponseText(response, 20_000) } catch { /* fixed message below */ }
  const lower = detail.toLowerCase()
  const status = response.status
  if (status === 401) return new FalError('fal.ai rejected the API key. Check it in Settings → API keys.')
  if (lower.includes('balance') || lower.includes('locked') || status === 402) return new FalError('Your fal.ai balance is empty. Add credits at fal.ai/dashboard/billing, then try again.')
  if (status === 403) return new FalError('fal.ai refused the request. Check your API key and account in the fal.ai dashboard.')
  if (status === 429) return new FalError('fal.ai is rate limiting requests. Try again in a minute.')
  if (status === 422 || status === 400) {
    let reason = ''
    try {
      const parsed = JSON.parse(detail) as { detail?: unknown }
      const first = Array.isArray(parsed.detail) ? parsed.detail[0] as { msg?: unknown } : null
      reason = typeof first?.msg === 'string' ? first.msg : typeof parsed.detail === 'string' ? parsed.detail : ''
    } catch { /* no reason */ }
    reason = reason.replace(/[^\x20-\x7E]/g, '').slice(0, 200)
    if (/content|safety|nsfw|policy/i.test(reason)) return new FalError('fal.ai blocked this request under its content rules. Try a different prompt or photo.')
    return new FalError(`fal.ai could not process this request (${model})${reason ? `: ${reason}` : '.'}`)
  }
  return new FalError(`fal.ai request failed (${status}). Try again shortly.`)
}

function queueUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith(QUEUE_BASE)) throw new FalError('fal.ai returned an unexpected response.')
  return value
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, ms)
    const onAbort = (): void => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function json(response: Response, maxBytes = 2_000_000): Promise<Record<string, unknown>> {
  const raw = await readResponseText(response, maxBytes, 'fal.ai returned too much data.')
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch { /* fixed error below */ }
  throw new FalError('fal.ai returned an invalid response.')
}

/** Run one model through fal's queue and return its output JSON. */
export async function falRun(model: string, input: Record<string, unknown>, options: FalOptions): Promise<Record<string, unknown>> {
  if (!/^[a-z0-9-]+(?:\/[a-z0-9.-]+)+$/.test(model)) throw new FalError('Invalid fal.ai model')
  const doFetch = options.fetch ?? fetch
  const deadline = Date.now() + (options.timeoutMs ?? 20 * 60_000)
  let submitted: Response
  try {
    submitted = await doFetch(`${QUEUE_BASE}${model}`, { method: 'POST', headers: headers(options.key), body: JSON.stringify(input), redirect: 'error', signal: withTimeout(options.signal, 60_000) })
  } catch (error) {
    if (userAborted(error, options.signal)) throw error
    throw new FalError('fal.ai could not be reached. Check your connection and try again.')
  }
  if (!submitted.ok) throw await falFailure(submitted, model)
  const ticket = await json(submitted)
  const statusUrl = queueUrl(ticket.status_url)
  const responseUrl = queueUrl(ticket.response_url)
  const cancelUrl = typeof ticket.cancel_url === 'string' && ticket.cancel_url.startsWith(QUEUE_BASE) ? ticket.cancel_url : null
  const cancel = (): void => {
    if (cancelUrl) void doFetch(cancelUrl, { method: 'PUT', headers: headers(options.key, false), redirect: 'error', signal: AbortSignal.timeout(10_000) }).catch(() => undefined)
  }
  try {
    for (;;) {
      if (Date.now() > deadline) { cancel(); throw new FalError('fal.ai took too long to finish. Try again later.') }
      let response: Response
      try { response = await doFetch(statusUrl, { headers: headers(options.key, false), redirect: 'error', signal: withTimeout(options.signal, 30_000) }) }
      catch (error) {
        if (userAborted(error, options.signal)) throw error
        // A dropped poll is retried until the overall deadline.
        await sleep(options.pollMs ?? 2500, options.signal)
        continue
      }
      if (!response.ok) throw await falFailure(response, model)
      const status = await json(response)
      if (status.status === 'COMPLETED') {
        if (status.error) throw new FalError(`fal.ai could not finish this step (${model}). Try again or adjust the prompt.`)
        break
      }
      if (status.status === 'IN_QUEUE') options.onStatus?.(typeof status.queue_position === 'number' ? `In queue (position ${status.queue_position + 1})` : 'In queue')
      else if (status.status === 'IN_PROGRESS') options.onStatus?.('Generating')
      await sleep(options.pollMs ?? 2500, options.signal)
    }
    const result = await doFetch(responseUrl, { headers: headers(options.key, false), redirect: 'error', signal: withTimeout(options.signal, 60_000) })
    if (!result.ok) throw await falFailure(result, model)
    return await json(result)
  } catch (error) {
    if (userAborted(error, options.signal)) cancel()
    else if ((error as Error)?.name === 'AbortError' || (error as Error)?.name === 'TimeoutError') throw new FalError('fal.ai stopped responding. Try again shortly.')
    throw error
  }
}

/** The first file URL in a model output: video.url, audio.url or images[0].url. */
export function falFileUrl(output: Record<string, unknown>, field: 'video' | 'audio' | 'images'): string {
  const value = output[field]
  const file = Array.isArray(value) ? value[0] : value
  const url = (file as { url?: unknown } | undefined)?.url
  if (typeof url !== 'string' || !isFalResultUrl(url)) throw new FalError('fal.ai returned no usable file.')
  return url
}

export function isFalResultUrl(value: string): boolean {
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    return url.protocol === 'https:' && !url.username && !url.password && RESULT_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
  } catch { return false }
}

/** Download a fal result to `destination`, capped at `maxBytes`. Redirects must stay on fal hosts. */
export async function downloadFalFile(url: string, destination: string, options: Pick<FalOptions, 'signal' | 'fetch'> & { maxBytes?: number } = {}): Promise<void> {
  const doFetch = options.fetch ?? fetch
  const maxBytes = options.maxBytes ?? 500_000_000
  let current = url
  let response: Response | null = null
  for (let hop = 0; hop < 4; hop++) {
    if (!isFalResultUrl(current)) throw new FalError('fal.ai returned a file from an unexpected host.')
    response = await doFetch(current, { redirect: 'manual', signal: withTimeout(options.signal, 60_000) })
    if (response.status < 300 || response.status >= 400) break
    const location = response.headers.get('location')
    if (!location) throw new FalError('Downloading the result from fal.ai failed (bad redirect).')
    current = new URL(location, current).toString()
    response = null
  }
  if (!response) throw new FalError('Downloading the result from fal.ai failed (too many redirects).')
  if (!response.ok || !response.body) throw new FalError(`Downloading the result from fal.ai failed (${response.status}).`)
  const partial = `${destination}.part`
  const out = createWriteStream(partial, { flags: 'w', mode: 0o600 })
  const reader = response.body.getReader()
  let size = 0
  try {
    for (;;) {
      // Each chunk must arrive within a minute; a stalled transfer fails instead of hanging.
      const chunk = reader.read()
      const timer = new Promise<never>((_, reject) => { const t = setTimeout(() => reject(new FalError('The download from fal.ai stalled. Try again.')), 60_000); void chunk.finally(() => clearTimeout(t)) })
      const { done, value } = await Promise.race([chunk, timer])
      if (done) break
      size += value.byteLength
      if (size > maxBytes) throw new FalError('The file from fal.ai is too large.')
      if (!out.write(value)) await new Promise<void>((resolve) => out.once('drain', () => resolve()))
    }
    await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => error ? reject(error) : resolve()))
    await rename(partial, destination)
  } catch (error) {
    out.destroy()
    await reader.cancel().catch(() => undefined)
    await rm(partial, { force: true })
    throw error
  }
}

/**
 * Make local bytes usable as a model input URL. Small files go inline as a
 * data URI; larger ones are uploaded to fal's storage, falling back to inline
 * if the upload endpoint is unavailable.
 */
export async function falInputUrl(bytes: Buffer, contentType: string, fileName: string, options: Pick<FalOptions, 'key' | 'signal' | 'fetch'>): Promise<string> {
  const inline = `data:${contentType};base64,${bytes.toString('base64')}`
  if (bytes.byteLength <= 2_000_000) return inline
  const doFetch = options.fetch ?? fetch
  try {
    const initiated = await doFetch(STORAGE_INITIATE, { method: 'POST', headers: headers(options.key), body: JSON.stringify({ content_type: contentType, file_name: fileName }), redirect: 'error', signal: withTimeout(options.signal, 30_000) })
    if (!initiated.ok) throw new Error('initiate failed')
    const ticket = await json(initiated)
    const uploadUrl = ticket.upload_url, fileUrl = ticket.file_url
    if (typeof uploadUrl !== 'string' || !uploadUrl.startsWith('https://') || typeof fileUrl !== 'string' || !isFalResultUrl(fileUrl)) throw new Error('bad ticket')
    const put = await doFetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: new Uint8Array(bytes), redirect: 'error', signal: withTimeout(options.signal, 5 * 60_000) })
    if (!put.ok) throw new Error('upload failed')
    return fileUrl
  } catch (error) {
    if (userAborted(error, options.signal)) throw error
    if (bytes.byteLength > 15_000_000) throw new FalError('Uploading the file to fal.ai failed. Try a shorter or smaller file.')
    return inline
  }
}
