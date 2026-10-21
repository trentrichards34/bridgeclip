/**
 * "Say what it's for": an optional one-line purpose ("Instagram reel selling my
 * coaching call") and an optional reference image ("A look you like") on
 * Create, Edit my recording and Remix. Both go to the AI planning call as
 * context. The image is sent only when the planning model accepts images; it
 * is always kept with the run. A suggested look (a color and a caption style)
 * is worked out from the image on this computer.
 */

import type { CaptionPresetId } from './caption-presets'

export const MAX_PURPOSE_CHARS = 200
export const REFERENCE_MAX_BYTES = 8 * 1024 * 1024
export const REFERENCE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp']
/** The longest side the engine sends to the model (it scales larger pictures down first). */
export const REFERENCE_MODEL_EDGE = 1024
export const REFERENCE_SKIPPED_NOTE = 'Your model can’t look at images; the reference is skipped.'

/**
 * The planning models when the member doesn't choose one (the engine's defaults: engine/clip_engine/config.py
 * planner_model, and bridge_runner.py for Lower cost). Edit my recording and Remix use the default.
 */
export const DEFAULT_PLANNER_MODEL = 'anthropic/claude-opus-5.5'
export const ECONOMY_PLANNER_MODEL = 'z-ai/glm-5.3-flash'

/** A picture the member chose, copied into the app's data folder. */
export interface ReferenceImage {
  id: string
  name: string
  /** The copy (authorized for preview in the page). */
  path: string
  width: number
  height: number
  bytes: number
}

/** Whether the planning model can look at the picture, and what it adds (an estimate). */
export interface ReferenceSupport {
  model: string
  modelName: string | null
  /** null: the model list couldn't be read, so it's unknown (the picture is skipped). */
  supportsImages: boolean | null
  tokens: number
  /** null: the model's price isn't listed. */
  costUsd: number | null
}

const REFERENCE_ID = /^[a-f0-9]{24}$/
export function isReferenceId(value: unknown): value is string {
  return typeof value === 'string' && REFERENCE_ID.test(value)
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/

/** The purpose line, checked: '' for none. Throws with a plain message. */
export function parsePurpose(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error('Describe what the video is for in a short line.')
  const line = value.replace(/\s+/g, ' ').trim()
  if (line.length > MAX_PURPOSE_CHARS) throw new Error(`Keep “What’s this video for?” to ${MAX_PURPOSE_CHARS} characters.`)
  if (CONTROL.test(line) || /[<>{}\\]/.test(line)) throw new Error('Use plain words for what the video is for (no < > { } or \\).')
  return line
}

/** The planning model a run uses (for the image check). */
export function plannerModelFor(mode: 'quality' | 'economy' | 'advanced' | undefined, plannerModel?: string): string {
  if (mode === 'advanced' && plannerModel) return plannerModel
  return mode === 'economy' ? ECONOMY_PLANNER_MODEL : DEFAULT_PLANNER_MODEL
}

/** The picture type from its first bytes (PNG, JPEG or WebP), or null. */
export function referenceKind(bytes: Uint8Array): 'png' | 'jpg' | 'webp' | null {
  const at = (i: number, ...values: number[]): boolean => values.every((v, k) => bytes[i + k] === v)
  if (bytes.byteLength >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png'
  if (bytes.byteLength >= 3 && at(0, 0xff, 0xd8, 0xff)) return 'jpg'
  if (bytes.byteLength >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'webp'
  return null
}

/** A picture's size from its header (PNG, JPEG, WebP), or null when it can't be read. */
export function imageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const kind = referenceKind(bytes)
  const u16be = (i: number): number => (bytes[i] << 8) | bytes[i + 1]
  const u16le = (i: number): number => bytes[i] | (bytes[i + 1] << 8)
  const u24le = (i: number): number => bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16)
  const u32be = (i: number): number => ((bytes[i] << 24) >>> 0) + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3]
  const ok = (size: { width: number; height: number }): { width: number; height: number } | null =>
    size.width > 0 && size.height > 0 && size.width <= 30000 && size.height <= 30000 ? size : null
  if (kind === 'png') return bytes.byteLength >= 24 ? ok({ width: u32be(16), height: u32be(20) }) : null
  if (kind === 'webp') {
    if (bytes.byteLength < 30) return null
    const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15])
    if (chunk === 'VP8X') return ok({ width: u24le(24) + 1, height: u24le(27) + 1 })
    if (chunk === 'VP8L') {
      const b = (i: number): number => bytes[21 + i]
      return ok({ width: 1 + (((b(1) & 0x3f) << 8) | b(0)), height: 1 + (((b(3) & 0xf) << 10) | (b(2) << 2) | ((b(1) & 0xc0) >> 6)) })
    }
    if (chunk === 'VP8 ') return ok({ width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff })
    return null
  }
  if (kind === 'jpg') {
    let i = 2
    while (i + 9 < bytes.byteLength) {
      if (bytes[i] !== 0xff) { i++; continue }
      const marker = bytes[i + 1]
      if (marker === 0xff) { i++; continue }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
      const length = u16be(i + 2)
      // Start of frame (baseline, progressive, ...): not DHT (C4), JPG (C8) or DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return ok({ width: u16be(i + 7), height: u16be(i + 5) })
      if (length < 2) return null
      i += 2 + length
    }
  }
  return null
}

/**
 * About how many input tokens the picture adds to one planning call: scaled to the edge the engine sends, then
 * about one token per 750 pixels (how Anthropic's models count images; other providers count differently, so this
 * is an estimate).
 */
export function referenceImageTokens(width: number, height: number): number {
  if (!(width > 0 && height > 0)) return 0
  const scale = Math.min(1, REFERENCE_MODEL_EDGE / Math.max(width, height))
  return Math.ceil((Math.round(width * scale) * Math.round(height * scale)) / 750)
}

/** What those tokens cost at the model's listed price per input token (null when it isn't listed). */
export function referenceCostUsd(tokens: number, inputPricePerToken: number | null): number | null {
  return inputPricePerToken === null || !Number.isFinite(inputPricePerToken) ? null : tokens * inputPricePerToken
}

/** One plain line on what the picture adds to the cost, for the page (the estimate itself is in referenceCostDetail). */
export function referenceCostLine(support: ReferenceSupport | null): string | null {
  if (!support) return null
  if (support.supportsImages === false) return REFERENCE_SKIPPED_NOTE
  if (support.supportsImages === null) return 'The model list couldn’t be checked, so the reference is skipped this time. It’s still saved with the video.'
  const cost = support.costUsd === null ? '' : support.costUsd < 0.01 ? ' (under 1¢)' : ` (about $${support.costUsd.toFixed(2)} per planning call)`
  return `Adds a little to the AI cost${cost}.`
}

/** The estimate behind that line, for its details (null when the picture isn't sent). */
export function referenceCostDetail(support: ReferenceSupport | null): string | null {
  if (!support?.supportsImages) return null
  const cost = support.costUsd === null ? '' : `, about $${support.costUsd < 0.0001 ? support.costUsd.toFixed(6) : support.costUsd.toFixed(4)}`
  const at = support.costUsd === null ? '' : ` at ${support.modelName ?? support.model}’s listed price`
  return `About ${support.tokens.toLocaleString('en-US')} extra input tokens on each planning call${cost}${at}. An estimate.`
}

export interface ReferenceLook {
  /** The most common strong color, as #RRGGBB (or the average color when nothing stands out). */
  color: string
  /** Mostly light (true) or mostly dark. */
  light: boolean
  captionPreset: CaptionPresetId
}

/**
 * A suggested look from the picture's pixels (RGBA, as a canvas gives them): its dominant color as the brand
 * color, and a caption style by how light it is (Paper's dark type on a white card for a light picture, Pop for
 * a dark one). Null when there are no pixels.
 */
export function deriveReferenceLook(rgba: ArrayLike<number>): ReferenceLook | null {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
  let count = 0, luma = 0, sr = 0, sg = 0, sb = 0
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2]
    count++
    luma += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    sr += r; sg += g; sb += b
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    const light = (max + min) / 510
    const saturation = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255))
    // Strong colors only: not grays, not near black or white.
    if (saturation < 0.25 || light < 0.12 || light > 0.9) continue
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5)
    const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
    bucket.n++; bucket.r += r; bucket.g += g; bucket.b += b
    buckets.set(key, bucket)
  }
  if (!count) return null
  let best: { n: number; r: number; g: number; b: number } | null = null
  for (const bucket of buckets.values()) if (!best || bucket.n > best.n) best = bucket
  // A color has to cover a little of the picture to count as its color.
  const pick = best && best.n >= count * 0.02 ? { r: best.r / best.n, g: best.g / best.n, b: best.b / best.n } : { r: sr / count, g: sg / count, b: sb / count }
  const hex = (v: number): string => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')
  const light = luma / count > 0.55
  return { color: `#${hex(pick.r)}${hex(pick.g)}${hex(pick.b)}`.toUpperCase(), light, captionPreset: light ? 'paper' : 'pop' }
}
