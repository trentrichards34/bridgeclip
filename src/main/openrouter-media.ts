import { app } from 'electron'
import { createWriteStream } from 'fs'
import { rm } from 'fs/promises'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { logger } from './logger'
import { assertPublicWebUrl } from './network-policy'
import { OUT_OF_CREDITS_MESSAGES } from '../shared/spending'

/**
 * Images, speech and video through OpenRouter with the user's own key: the
 * same account Remix, clipping and script writing already use.
 *   images: POST /images                 → data[].b64_json
 *   speech: POST /audio/speech           → raw audio bytes
 *   video:  POST /videos → GET /videos/{id} (poll) → GET /videos/{id}/content
 */

export class OpenRouterMediaError extends Error {}

export interface MediaOptions {
  key: string
  signal?: AbortSignal
  /** Short status while a video job waits, e.g. "In progress". */
  onStatus?: (status: string) => void
  fetch?: typeof fetch
  /** Video jobs: how often to poll and the overall limit. */
  pollMs?: number
  timeoutMs?: number
  /** Tests: replaces the DNS check on redirect targets. */
  assertPublic?: (url: string) => Promise<void>
}

/** One finished paid media call, for the spend ledger: the cost OpenRouter reported (null when none) and what's needed to estimate it. */
export interface MediaCharge { what: 'image' | 'speech' | 'video' | 'text'; model: string; usd: number | null; chars?: number; seconds?: number }
let chargeListener: (charge: MediaCharge) => void = () => undefined
export function onMediaCharge(listener: (charge: MediaCharge) => void): void { chargeListener = listener }
function charged(charge: MediaCharge): void {
  try { chargeListener(charge) } catch { /* recording never fails the call */ }
}

/** A finished OpenRouter text or transcription call made elsewhere (post captions): its reported cost goes to the spend ledger. */
export function reportOpenRouterUsage(model: string, body: unknown): void {
  const usage = body && typeof body === 'object' ? (body as { usage?: { cost?: unknown } }).usage : undefined
  const cost = usage?.cost
  if (typeof cost === 'number' && Number.isFinite(cost) && cost > 0) charged({ what: 'text', model, usd: cost })
}
function reportedCost(json: Record<string, unknown>): number | null {
  const cost = (json.usage as { cost?: unknown } | undefined)?.cost
  return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null
}

const MAX_IMAGE_BYTES = 30_000_000
const MAX_AUDIO_BYTES = 50_000_000
const MAX_VIDEO_BYTES = 500_000_000
const JOB_ID = /^[A-Za-z0-9_-]{1,128}$/

export function openRouterBase(): string {
  const fallback = 'https://openrouter.ai/api/v1'
  return app.isPackaged ? fallback : (process.env.BRIDGECLIP_E2E_OPENROUTER_MEDIA_URL || fallback)
}

function headers(key: string, json = true): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`, 'HTTP-Referer': 'https://github.com/trentrichards34/creatorclips-releases', 'X-Title': 'CreatorClips Avatar Studio',
    ...(json ? { 'Content-Type': 'application/json' } : {})
  }
}

function aborted(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted) || (error as { name?: string } | null)?.name === 'AbortError'
}

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms)
}

export function failure(status: number, what: string): OpenRouterMediaError {
  if (status === 401 || status === 403) return new OpenRouterMediaError('OpenRouter rejected the API key. Check it in Settings → API keys.')
  if (status === 402) return new OpenRouterMediaError(OUT_OF_CREDITS_MESSAGES.openrouter)
  if (status === 429) return new OpenRouterMediaError(`OpenRouter is busy and could not ${what} right now. Try again shortly.`)
  if (status === 400 || status === 422) return new OpenRouterMediaError(`OpenRouter could not ${what}: the request was rejected. Try again with different wording or a different file.`)
  return new OpenRouterMediaError(`OpenRouter could not ${what} (${status}). Try again.`)
}

/** The request never left this computer (so retrying a paid POST can't charge twice). */
function neverSent(error: unknown): boolean {
  const code = (error as { cause?: { code?: string } } | null)?.cause?.code
  return ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH'].includes(code ?? '')
}

async function send(path: string, init: RequestInit, options: MediaOptions, what: string, ms: number): Promise<Response> {
  const doFetch = options.fetch ?? fetch
  // A POST starts paid work. Once it may have reached OpenRouter (a timeout or a 5xx), sending it
  // again could pay twice, so POSTs retry only when it surely didn't (busy, or never connected).
  const post = (init.method ?? 'GET').toUpperCase() === 'POST'
  for (let attempt = 0; ; attempt++) {
    let response: Response
    try {
      response = await doFetch(`${openRouterBase()}${path}`, { ...init, redirect: 'manual', signal: withTimeout(options.signal, ms) })
    } catch (error) {
      if (aborted(error, options.signal)) throw error
      if (attempt < 2 && (!post || neverSent(error))) { await sleep(1500 * (attempt + 1), options.signal); continue }
      if ((error as { name?: string } | null)?.name === 'TimeoutError') throw new OpenRouterMediaError(`OpenRouter took too long to ${what}. Try again.`)
      throw new OpenRouterMediaError('OpenRouter could not be reached. Check your connection and try again.')
    }
    if ((post ? [429] : [408, 429, 500, 502, 503, 504]).includes(response.status) && attempt < 2) {
      const wait = Math.min(20_000, Math.max(1000, Number(response.headers.get('retry-after')) * 1000 || 2000 * (attempt + 1)))
      await sleep(wait, options.signal)
      continue
    }
    if (!response.ok && !(response.status >= 300 && response.status < 400)) {
      const detail = await response.text().catch(() => '')
      if (detail) logger.warn('openrouter.media.rejected', { what, status: response.status, detail: detail.slice(0, 300) })
      throw failure(response.status, what)
    }
    return response
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve() }, ms)
    const stop = (): void => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }
    signal?.addEventListener('abort', stop, { once: true })
  })
}

async function boundedJson(response: Response, max: number, what: string): Promise<Record<string, unknown>> {
  const bytes = await boundedBytes(response, max, what)
  try { return JSON.parse(Buffer.from(bytes).toString('utf8')) as Record<string, unknown> }
  catch { throw new OpenRouterMediaError(`OpenRouter returned an unreadable reply while trying to ${what}.`) }
}

async function boundedBytes(response: Response, max: number, what: string): Promise<Uint8Array> {
  const length = Number(response.headers.get('content-length'))
  if (length > max) throw new OpenRouterMediaError(`OpenRouter returned too much data while trying to ${what}.`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length > max) throw new OpenRouterMediaError(`OpenRouter returned too much data while trying to ${what}.`)
  return bytes
}

export function dataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export interface ImageRequest {
  model: string
  prompt: string
  /** Reference photos (JPEG/PNG bytes) the image keeps, e.g. the avatar's face. */
  references?: { bytes: Uint8Array; mime: string }[]
  aspectRatio?: string
}

/** One generated image as bytes. */
export async function generateImage(request: ImageRequest, options: MediaOptions): Promise<Uint8Array> {
  const body = {
    model: request.model, prompt: request.prompt, ...(request.aspectRatio ? { aspect_ratio: request.aspectRatio } : {}),
    ...(request.references?.length ? { input_references: request.references.map((ref) => ({ type: 'image_url', image_url: { url: dataUrl(ref.bytes, ref.mime) } })) } : {})
  }
  const response = await send('/images', { method: 'POST', headers: headers(options.key), body: JSON.stringify(body) }, options, 'make the image', 5 * 60_000)
  const json = await boundedJson(response, MAX_IMAGE_BYTES * 2, 'make the image')
  charged({ what: 'image', model: request.model, usd: reportedCost(json) })
  const first = Array.isArray(json.data) ? json.data[0] as { b64_json?: unknown; url?: unknown } | undefined : undefined
  if (typeof first?.b64_json === 'string' && first.b64_json) {
    const bytes = Buffer.from(first.b64_json, 'base64')
    if (bytes.length > 0 && bytes.length <= MAX_IMAGE_BYTES) return new Uint8Array(bytes)
  }
  throw new OpenRouterMediaError('OpenRouter returned no image. Try a different description.')
}

// ---------------------------------------------------------------------------
// Speech
// ---------------------------------------------------------------------------

export interface SpeechRequest {
  model: string
  input: string
  voice?: string
  /** Voice cloning: reference recordings (and optional transcripts) sent with each request. */
  references?: { audio: Uint8Array; mime: string; transcript?: string }[]
  instructions?: string
}

/** MP3 bytes of the spoken text. */
export async function synthesizeSpeech(request: SpeechRequest, options: MediaOptions): Promise<Uint8Array> {
  const body = {
    model: request.model, input: request.input, response_format: 'mp3',
    ...(request.voice ? { voice: request.voice } : {}),
    ...(request.instructions ? { instructions: request.instructions } : {}),
    ...(request.references?.length ? {
      input_references: request.references.flatMap((ref) => [
        { type: 'input_audio', input_audio: { data: dataUrl(ref.audio, ref.mime) } },
        ...(ref.transcript ? [{ type: 'text', text: ref.transcript.slice(0, 10_000) }] : [])
      ])
    } : {})
  }
  const response = await send('/audio/speech', { method: 'POST', headers: headers(options.key), body: JSON.stringify(body) }, options, 'record the voice', 5 * 60_000)
  const bytes = await boundedBytes(response, MAX_AUDIO_BYTES, 'record the voice')
  charged({ what: 'speech', model: request.model, usd: null, chars: request.input.length })
  if (bytes.length === 0) throw new OpenRouterMediaError('OpenRouter returned an empty voice recording. Try again.')
  return bytes
}

// ---------------------------------------------------------------------------
// Video jobs
// ---------------------------------------------------------------------------

export interface VideoRequest {
  model: string
  prompt: string
  aspectRatio?: string
  resolution?: string
  duration?: number
  generateAudio?: boolean
  /** Image-to-video: the shot's opening frame. */
  firstFrame?: { bytes: Uint8Array; mime: string }
  /** Reference inputs, e.g. the avatar's photo and the voiceover for a talking head. */
  references?: ({ kind: 'image'; bytes: Uint8Array; mime: string } | { kind: 'audio'; bytes: Uint8Array; mime: string })[]
}

const IN_PROGRESS = new Set(['pending', 'queued', 'in_progress', 'processing', 'running', 'starting'])

/** Run a video job to completion and save the result; returns the cost OpenRouter reported, if any. */
export async function generateVideo(request: VideoRequest, destination: string, options: MediaOptions): Promise<{ costUsd: number | null }> {
  const body = {
    model: request.model, prompt: request.prompt,
    ...(request.aspectRatio ? { aspect_ratio: request.aspectRatio } : {}),
    ...(request.resolution ? { resolution: request.resolution } : {}),
    ...(request.duration ? { duration: request.duration } : {}),
    ...(request.generateAudio !== undefined ? { generate_audio: request.generateAudio } : {}),
    ...(request.firstFrame ? { frame_images: [{ type: 'image_url', image_url: { url: dataUrl(request.firstFrame.bytes, request.firstFrame.mime) }, frame_type: 'first_frame' }] } : {}),
    ...(request.references?.length ? {
      input_references: request.references.map((ref) => ref.kind === 'image'
        ? { type: 'image_url', image_url: { url: dataUrl(ref.bytes, ref.mime) } }
        : { type: 'input_audio', input_audio: { data: dataUrl(ref.bytes, ref.mime) } })
    } : {})
  }
  const started = await send('/videos', { method: 'POST', headers: headers(options.key), body: JSON.stringify(body) }, options, 'start the video', 120_000)
  let job = await boundedJson(started, 1_000_000, 'start the video')
  const id = job.id
  if (typeof id !== 'string' || !JOB_ID.test(id)) throw new OpenRouterMediaError('OpenRouter returned an invalid video job.')
  const deadline = Date.now() + (options.timeoutMs ?? 30 * 60_000)
  const pollMs = options.pollMs ?? 10_000
  while (IN_PROGRESS.has(String(job.status ?? 'pending').toLowerCase())) {
    if (Date.now() > deadline) throw new OpenRouterMediaError('The video took too long on OpenRouter. Try again later.')
    options.onStatus?.(String(job.status ?? 'pending').toLowerCase() === 'in_progress' ? 'In progress' : 'Queued')
    await sleep(pollMs, options.signal)
    try {
      const poll = await send(`/videos/${id}`, { headers: headers(options.key, false) }, options, 'check the video', 60_000)
      job = await boundedJson(poll, 1_000_000, 'check the video')
    } catch (error) {
      if (aborted(error, options.signal)) throw error
      if (error instanceof OpenRouterMediaError && /API key|credits/.test(error.message)) throw error
      // A dropped poll is retried until the deadline.
    }
  }
  if (String(job.status).toLowerCase() !== 'completed') {
    const reason = typeof job.error === 'string' ? job.error : typeof (job.error as { message?: unknown } | undefined)?.message === 'string' ? (job.error as { message: string }).message : ''
    if (reason) logger.warn('openrouter.video.failed', { reason: reason.slice(0, 300) })
    throw new OpenRouterMediaError('The video could not be made on OpenRouter. Try again, or adjust the script.')
  }
  const costUsd = reportedCost(job)
  // Paid once the job completed, even if the download below fails.
  charged({ what: 'video', model: request.model, usd: costUsd, seconds: request.duration })
  await downloadVideo(id, destination, options)
  return { costUsd }
}

async function downloadVideo(id: string, destination: string, options: MediaOptions): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      let response = await send(`/videos/${id}/content?index=0`, { headers: headers(options.key, false) }, options, 'download the video', 10 * 60_000)
      if (response.status >= 300 && response.status < 400) {
        // A redirect to the file host is followed without our key.
        const location = response.headers.get('location') ?? ''
        if (!location.startsWith('https://')) throw new OpenRouterMediaError('The video could not be downloaded.')
        // Same rule as the engine's network guard: never follow a redirect into the local network.
        try { await (options.assertPublic ?? assertPublicWebUrl)(location) } catch { throw new OpenRouterMediaError('The video could not be downloaded.') }
        response = await (options.fetch ?? fetch)(location, { redirect: 'error', signal: withTimeout(options.signal, 10 * 60_000) })
        if (!response.ok) throw failure(response.status, 'download the video')
      }
      const length = Number(response.headers.get('content-length'))
      if (length > MAX_VIDEO_BYTES || !response.body) throw new OpenRouterMediaError('The video could not be downloaded.')
      let size = 0
      const limited = Readable.fromWeb(response.body as import('stream/web').ReadableStream).on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_VIDEO_BYTES) limited.destroy(new OpenRouterMediaError('The video file was unexpectedly large.'))
      })
      await pipeline(limited, createWriteStream(destination))
      if (size === 0) throw new OpenRouterMediaError('OpenRouter returned an empty video.')
      return
    } catch (error) {
      await rm(destination, { force: true }).catch(() => undefined)
      if (aborted(error, options.signal) || attempt >= 1 || (error instanceof OpenRouterMediaError && /API key|credits|large/.test(error.message))) {
        throw error instanceof OpenRouterMediaError || aborted(error, options.signal) ? error : new OpenRouterMediaError('The video could not be downloaded. Try again.')
      }
      await sleep(3000, options.signal)
    }
  }
}
