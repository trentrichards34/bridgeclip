/**
 * Brand kit: the visual defaults saved with a Brand Identity (color, hook look,
 * caption style, call to action, comment keyword, and an on-video @handle or
 * logo). Choosing a brand on Create or Remix fills that form's style fields
 * from it; the member can still change them afterward.
 *
 * Every field is optional, so brand files saved before the kit existed (just
 * a name and text) keep working.
 */

import { isCaptionPresetId } from './caption-presets'
import { isCtaId } from './ctas'
import { isHexColor, parseHeadlineLook, type HeadlineLook } from './headline-look'
import { ctaLine, MAX_CTA_OFFER_CHARS, normalizeCtaKeyword, type CameraSettings } from './remix'

export type HandlePosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
export const HANDLE_POSITIONS: readonly { id: HandlePosition; label: string }[] = [
  { id: 'top-left', label: 'Top left' },
  { id: 'top-right', label: 'Top right' },
  { id: 'bottom-left', label: 'Bottom left' },
  { id: 'bottom-right', label: 'Bottom right' }
]
export const DEFAULT_HANDLE_POSITION: HandlePosition = 'bottom-right'
export const MAX_HANDLE_CHARS = 30
/** Logos the member picks: PNG, JPG or WebP up to 5 MB (stored as a PNG in userData). */
export const LOGO_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp']
export const MAX_LOGO_BYTES = 5 * 1024 * 1024
/** A stored logo's file name in userData/brand-logos. */
const LOGO_FILE = /^[a-f0-9]{16}\.png$/

export interface BrandLook {
  /** The brand color (#RRGGBB): the hook bar in brand color and the camera backdrop. */
  color?: string
  /** How the hook text looks by default (its color follows `color`). */
  headlineLook?: HeadlineLook
  captionPreset?: string
  /** A call to action from the CTA library. */
  ctaId?: string
  /** Comment keyword ("SALES") and what commenters get. */
  ctaKeyword?: string
  ctaOffer?: string
  /** On-video handle text, e.g. "@coachname". */
  handle?: string
  handlePosition?: HandlePosition
  /** The logo's file name in userData/brand-logos (main only resolves it). */
  logo?: string
}

export function isHandlePosition(value: unknown): value is HandlePosition {
  return typeof value === 'string' && HANDLE_POSITIONS.some((item) => item.id === value)
}

export function isLogoFile(value: unknown): value is string {
  return typeof value === 'string' && LOGO_FILE.test(value)
}

/** The handle as drawn: one line of 1-30 characters with no control characters, '' for none, null when it can't be one. */
export function normalizeHandle(value: unknown): string | null {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') return null
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value.replace(/[\t ]/g, ' '))) return null
  const handle = value.replace(/\s+/g, ' ').trim()
  return handle.length <= MAX_HANDLE_CHARS ? handle : null
}

function offerText(value: unknown): string | null {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string' || /[\0\r\n]/.test(value)) return null
  const offer = value.replace(/\s+/g, ' ').trim()
  return offer.length <= MAX_CTA_OFFER_CHARS ? offer : null
}

/**
 * A stored look, read leniently: anything unknown or invalid is dropped, so a
 * damaged field never hides the brand itself.
 */
export function readBrandLook(value: unknown): BrandLook {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const raw = value as Record<string, unknown>
  const look: BrandLook = {}
  if (isHexColor(raw.color)) look.color = raw.color.toUpperCase()
  if (raw.headlineLook !== undefined) {
    try { look.headlineLook = parseHeadlineLook(raw.headlineLook) } catch { /* dropped */ }
  }
  if (isCaptionPresetId(raw.captionPreset)) look.captionPreset = raw.captionPreset
  if (isCtaId(raw.ctaId)) look.ctaId = raw.ctaId
  const keyword = normalizeCtaKeyword(raw.ctaKeyword)
  if (keyword) {
    look.ctaKeyword = keyword
    const offer = offerText(raw.ctaOffer)
    if (offer) look.ctaOffer = offer
  }
  const handle = normalizeHandle(raw.handle)
  if (handle) look.handle = handle
  if (isHandlePosition(raw.handlePosition)) look.handlePosition = raw.handlePosition
  if (isLogoFile(raw.logo)) look.logo = raw.logo
  return look
}

/** A look the member saved (untrusted): throws a plain message on the first bad field. */
export function parseBrandLook(value: unknown): BrandLook {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Check your brand’s look.')
  const raw = value as Record<string, unknown>
  const known = ['color', 'headlineLook', 'captionPreset', 'ctaId', 'ctaKeyword', 'ctaOffer', 'handle', 'handlePosition', 'logo']
  if (Object.keys(raw).some((key) => !known.includes(key))) throw new Error('Check your brand’s look.')
  const given = (key: string): boolean => raw[key] !== undefined && raw[key] !== null && raw[key] !== ''
  if (given('color') && !isHexColor(raw.color)) throw new Error('Pick a brand color.')
  if (given('headlineLook')) {
    try { parseHeadlineLook(raw.headlineLook) } catch { throw new Error('Pick a look for the hook text.') }
  }
  if (given('captionPreset') && !isCaptionPresetId(raw.captionPreset)) throw new Error('Pick a caption style.')
  if (given('ctaId') && !isCtaId(raw.ctaId)) throw new Error('Choose a call to action from your library.')
  if (given('ctaKeyword') && !normalizeCtaKeyword(raw.ctaKeyword)) throw new Error('Use one word for the comment keyword, like SALES.')
  if (offerText(raw.ctaOffer) === null) throw new Error(`Keep what commenters get under ${MAX_CTA_OFFER_CHARS} characters, on one line.`)
  if (normalizeHandle(raw.handle) === null) throw new Error(`Keep your handle to ${MAX_HANDLE_CHARS} characters, on one line.`)
  if (given('handlePosition') && !isHandlePosition(raw.handlePosition)) throw new Error('Pick a corner for your handle.')
  if (given('logo') && !isLogoFile(raw.logo)) throw new Error('Choose your logo again.')
  const look = readBrandLook(raw)
  // The hook bar in brand color uses the brand color.
  if (look.headlineLook && look.color) look.headlineLook = { ...look.headlineLook, color: look.color }
  return look
}

/** The brand has something to draw on the video. */
export function hasBrandMark(look: BrandLook | undefined): boolean {
  return Boolean(look?.handle || look?.logo)
}

/** The style fields a brand can fill. Camera fields only exist on Remix. */
export interface BrandFormFields {
  headlineLook: HeadlineLook
  captionPreset: string
  ctaId: string | null
  ctaKeyword: string
  ctaOffer: string
  showHandle: boolean
  camera?: CameraSettings
  imageCamera?: CameraSettings
}

/**
 * What choosing this brand changes on a form: only the fields the brand sets,
 * starting from the form's current values. Apply it when the member picks a
 * different brand, never on re-selecting the same one (that would overwrite
 * what they changed since).
 */
export function brandFormPatch(look: BrandLook | undefined, form: BrandFormFields): Partial<BrandFormFields> {
  if (!look) return {}
  const patch: Partial<BrandFormFields> = {}
  if (look.headlineLook) patch.headlineLook = { ...look.headlineLook, color: look.color ?? look.headlineLook.color }
  else if (look.color) patch.headlineLook = { ...form.headlineLook, color: look.color }
  if (look.captionPreset) patch.captionPreset = look.captionPreset
  if (look.ctaId) patch.ctaId = look.ctaId
  if (look.ctaKeyword) {
    patch.ctaKeyword = look.ctaKeyword
    patch.ctaOffer = look.ctaOffer ?? ''
  }
  if (hasBrandMark(look)) patch.showHandle = true
  if (look.color && form.camera) patch.camera = { ...form.camera, backdropColor: look.color }
  if (look.color && form.imageCamera) patch.imageCamera = { ...form.imageCamera, backdropColor: look.color }
  return patch
}

/** The comment-keyword line at the end of a Create clip's post caption (same words as Remix). */
export function createCtaLine(keyword: string, offer: string): string {
  return keyword ? ctaLine(keyword, offer) : ''
}

/** What the engine draws: the handle and/or logo in a corner, small and see-through. */
export interface BrandMarkForEngine { handle: string; logo_path: string | null; position: HandlePosition }
